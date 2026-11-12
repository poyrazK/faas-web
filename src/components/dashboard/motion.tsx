import type { ReactNode } from 'react';

/**
 * The console's motion vocabulary: overlays and local feedback for an action,
 * selection or reported state change. Data pages still arrive in place.
 */

/** The console curve. Mirrored in CSS as `--motion-ease` / `ease-console`
 * (index.css) — change one, change both. */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Sidebar disclosures share the main console's directional timing. */
export const DISCLOSURE_OPEN = { duration: 0.26, ease: EASE } as const;
export const DISCLOSURE_CLOSE = { duration: 0.17, ease: [0.4, 0, 1, 1] } as const;

/** A keyed block: content that swaps (a tab, a range) remounts in place. */
export function Swap({ children, id }: { children: ReactNode; id: string | number }) {
  return <div key={id}>{children}</div>;
}
