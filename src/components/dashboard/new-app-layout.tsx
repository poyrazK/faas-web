import { useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft } from 'iconoir-react';
import { cn } from '@/lib/utils';
import type { AppSource } from './new-app-source';
import { SOURCES } from './new-app-sources';
import type { Station } from './new-app-station';
import { SourceGlyph } from './new-app-scenes';

export type NewAppLayout = 'track' | 'fold';

const KEY = 'gregale.dev.newAppLayout';
const ORDER: Record<Station, number> = { sources: 0, setup: 1, configure: 2, review: 3 };
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Which layout the wizard uses. Two exist while Bahadir chooses; outside dev
 * builds it is always Track, and the stored choice is never read.
 */
export function useNewAppLayout(): [NewAppLayout, (l: NewAppLayout) => void] {
  const [layout, setLayout] = useState<NewAppLayout>(() => {
    if (!import.meta.env.DEV) return 'track';
    try {
      return localStorage.getItem(KEY) === 'fold' ? 'fold' : 'track';
    } catch {
      return 'track';
    }
  });
  const choose = (next: NewAppLayout) => {
    setLayout(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Without storage the choice lasts this visit.
    }
  };
  return [layout, choose];
}

/** Dev only: flip between the two layouts while comparing them. */
export function DevLayoutSwitch({
  layout,
  onChange,
}: {
  layout: NewAppLayout;
  onChange: (l: NewAppLayout) => void;
}) {
  if (!import.meta.env.DEV) return null;
  return (
    <div
      role="radiogroup"
      aria-label="New app layout (dev only)"
      className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-1 rounded-full border border-border bg-popover p-1 font-mono text-[11px] shadow-elevation-3"
    >
      <span className="px-2 text-muted-foreground">Layout</span>
      {(['track', 'fold'] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={layout === l}
          onClick={() => onChange(l)}
          className={cn(
            'rounded-full px-3 py-1 capitalize transition-colors',
            layout === l ? 'bg-brand text-primary-foreground' : 'text-foreground hover:bg-accent'
          )}
        >
          {l === 'track' ? 'Track' : 'Fold'}
        </button>
      ))}
    </div>
  );
}

/**
 * Where the current station is shown. Track: one station at a time, sliding
 * sideways, with a named sliver to go back. Fold: the sources strip stays
 * beside every station after Sources.
 */
export function NewAppStage({
  layout,
  station,
  back,
  strip,
  children,
}: {
  layout: NewAppLayout;
  station: Station;
  back?: { label: string; onBack: () => void };
  strip?: ReactNode;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [seen, setSeen] = useState(station);
  const [dir, setDir] = useState(1);
  if (seen !== station) {
    setDir(ORDER[station] >= ORDER[seen] ? 1 : -1);
    setSeen(station);
  }
  // The old station leaves at once and the new one slides in from its side:
  // holding the old one through an exit animation left two stations'
  // controls in the page together, and a quick click hit the wrong one.
  const body = (
    <motion.div
      key={station}
      initial={reduce ? false : { x: `${dir * 6}%`, opacity: 0 }}
      animate={{ x: '0%', opacity: 1 }}
      transition={{ duration: reduce ? 0 : 0.42, ease: EASE }}
      className="min-w-0"
    >
      {children}
    </motion.div>
  );

  if (layout === 'fold') {
    const folded = station !== 'sources' && strip;
    return (
      <div
        data-layout="fold"
        className={cn('grid min-w-0 gap-6', folded && '@[40rem]:grid-cols-[12rem_minmax(0,1fr)]')}
      >
        {folded && (
          <motion.div
            initial={reduce ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: reduce ? 0 : 0.42, ease: EASE }}
          >
            {strip}
          </motion.div>
        )}
        {body}
      </div>
    );
  }

  return (
    <div
      data-layout="track"
      className={cn(
        'grid min-w-0 gap-4 overflow-x-clip',
        back && 'grid-cols-[3.5rem_minmax(0,1fr)]'
      )}
    >
      {back && (
        <button
          type="button"
          onClick={back.onBack}
          aria-label={`Back to ${back.label}`}
          className="group flex min-h-40 flex-col items-center gap-3 border border-border bg-card py-4 text-muted-foreground transition-colors hover:border-border-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ArrowLeft
            aria-hidden
            className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
          />
          <span
            aria-hidden
            className="font-mono text-[10.5px] uppercase tracking-[0.08em] [writing-mode:vertical-rl] rotate-180"
          >
            {back.label}
          </span>
        </button>
      )}
      {body}
    </div>
  );
}

/** Fold's strip: every source, switchable, beside the station. */
export function NewAppStrip({
  selected,
  onSelect,
}: {
  selected?: AppSource;
  onSelect: (id: AppSource) => void;
}) {
  return (
    <nav
      aria-label="Sources"
      className="nab-strip flex flex-row gap-px overflow-x-auto border border-border bg-border @[40rem]:flex-col @[40rem]:overflow-visible"
    >
      {SOURCES.map((s) => (
        <button
          key={s.id}
          type="button"
          aria-pressed={selected === s.id}
          onClick={() => onSelect(s.id)}
          className={cn(
            'flex h-12 w-12 shrink-0 items-center justify-center gap-3 bg-card text-left text-[13px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand @[40rem]:w-auto @[40rem]:justify-start @[40rem]:px-3',
            selected === s.id && 'shadow-[inset_2px_0_0_var(--brand)]'
          )}
        >
          <SourceGlyph id={s.id} />
          {/* A swatch alone in a narrow row; the name stays for assistive tech. */}
          <span className="truncate @max-[40rem]:sr-only">{s.name}</span>
        </button>
      ))}
    </nav>
  );
}
