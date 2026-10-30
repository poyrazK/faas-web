import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft } from 'iconoir-react';
import type { Station } from './new-app-station';

const ORDER: Record<Station, number> = { sources: 0, setup: 1, configure: 2, review: 3 };
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/**
 * Where the current station is shown: one station at a time, with a plain
 * way back above it. Moving on slides the new station in from the side it
 * comes from.
 *
 * The station's column is a region named `label`. `persistent` content sits in
 * that column below the station but outside its keyed body, so it survives
 * station changes (Import's draft lives there).
 */
export function NewAppStage({
  station,
  label,
  back,
  persistent,
  children,
}: {
  station: Station;
  label: string;
  back?: { label: string; onBack: () => void };
  persistent?: ReactNode;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const [seen, setSeen] = useState(station);
  const [dir, setDir] = useState(1);
  if (seen !== station) {
    setDir(ORDER[station] >= ORDER[seen] ? 1 : -1);
    setSeen(station);
  }

  // The control that moved the wizard on usually leaves with its station.
  // Then focus goes to the new station, which is named, rather than falling to
  // the page body; focus that survived the change stays put.
  const column = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected)
      column.current?.focus({ preventScroll: false });
  }, [station]);

  return (
    <div
      ref={column}
      role="region"
      aria-label={label}
      tabIndex={-1}
      className="flex min-w-0 flex-col gap-6 overflow-x-clip focus:outline-none"
    >
      {back && (
        <button
          type="button"
          onClick={back.onBack}
          aria-label={`Back to ${back.label}`}
          className="group inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ArrowLeft
            aria-hidden
            className="h-4 w-4 transition-transform group-hover:-translate-x-0.5 motion-reduce:transform-none"
          />
          {back.label}
        </button>
      )}
      {/* The old station leaves at once and the new one slides in: holding the
          old one through an exit animation left two stations' controls in the
          page together, and a quick click hit the wrong one. */}
      <motion.div
        key={station}
        initial={reduce ? false : { x: `${dir * 4}%`, opacity: 0 }}
        animate={{ x: '0%', opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.36, ease: EASE }}
        className="min-w-0 empty:hidden"
      >
        {children}
      </motion.div>
      {persistent}
    </div>
  );
}
