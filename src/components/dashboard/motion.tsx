import type { ReactNode } from 'react';

/**
 * The console's motion vocabulary, now down to what is functional: dialogs,
 * drawers, toasts and menus moving in and out. Content does not animate.
 */

/** The console curve. Mirrored in CSS as `--motion-ease` / `ease-console`
 * (index.css) — change one, change both. */
export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** A keyed block: content that swaps (a tab, a range) remounts in place. */
export function Swap({ children, id }: { children: ReactNode; id: string | number }) {
  return <div key={id}>{children}</div>;
}
