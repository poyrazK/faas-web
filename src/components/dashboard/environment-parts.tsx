import type { CSSProperties, ReactNode } from 'react';
import { MoreHoriz } from 'iconoir-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Tone } from './environment-words';

/** Small shared pieces of the Environment tab: a status dot, a lead line, a row menu. */

const TONE: Record<Tone, string> = {
  good: 'var(--status-good)',
  active: 'var(--brand)',
  idle: 'var(--muted-foreground)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
};

/** Colour is never the only signal: a dot always sits beside its word. */
export function ToneDot({ tone }: { tone: Tone }) {
  const style: CSSProperties =
    tone === 'idle'
      ? { boxShadow: `inset 0 0 0 1.5px ${TONE.idle}` }
      : { backgroundColor: TONE[tone] };
  return <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={style} />;
}

/** A dot and its word, with the exact term on hover. */
export function ToneWord({ tone, word, term }: { tone: Tone; word: string; term?: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-[13px] whitespace-nowrap"
      title={term}
    >
      <ToneDot tone={tone} />
      {word}
    </span>
  );
}

/** The one plain sentence under a section heading. */
export function Lead({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-6 text-pretty">{children}</p>;
}

/** The `⋯` trigger and menu for one row's actions. */
export function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        aria-label={label}
        className="pressable flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
      >
        <MoreHoriz aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Danger styling for a destructive menu item, from tokens. */
export const DANGER_ITEM = 'data-[highlighted]:text-[color:var(--status-critical)]';
