import { motion, useReducedMotion } from 'motion/react';
import { EASE } from './motion';

/**
 * The 2px progress bar along a panel's top edge — one implementation for
 * every build/deploy surface (BuildLog and DeploymentProgress each had their
 * own before, one Framer and one CSS, drifting apart).
 *
 * Decorative: pair it with an `aria-live` status line, which both callers
 * already carry. On `done` the bar fills and gives one brief brand pulse — a
 * settle, not a celebration; `failed` recolours to the critical token.
 */
export function ProgressEdge({
  progress,
  state = 'running',
}: {
  /** 0–100. Ignored once `state` is `done` (the bar fills). */
  progress: number;
  state?: 'running' | 'done' | 'failed';
}) {
  const reduce = useReducedMotion();
  const done = state === 'done';
  return (
    <div aria-hidden className="h-0.5 w-full bg-muted">
      <motion.div
        className="h-full"
        style={{ background: state === 'failed' ? 'var(--status-critical)' : 'var(--brand)' }}
        initial={false}
        animate={
          done && !reduce
            ? { width: '100%', opacity: [1, 0.45, 1] }
            : { width: `${done ? 100 : progress}%`, opacity: 1 }
        }
        transition={
          reduce
            ? { duration: 0 }
            : done
              ? { width: { duration: 0.5, ease: EASE }, opacity: { duration: 0.9, delay: 0.3 } }
              : { duration: 0.5, ease: EASE }
        }
      />
    </div>
  );
}
