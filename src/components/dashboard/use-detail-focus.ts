import { useLayoutEffect, useRef } from 'react';

/** Reveal URL-selected evidence; return to its row on Close or browser Back. */
export function useDetailFocus(selection: string) {
  const panelRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const origin = document.activeElement;
    panel?.focus({ preventScroll: true });
    panel?.scrollIntoView({ block: 'start', behavior: 'instant' });
    return () => {
      if (
        origin instanceof HTMLElement &&
        origin.isConnected &&
        (panel?.contains(document.activeElement) || document.activeElement === document.body)
      )
        origin.focus();
    };
  }, [selection]);
  return panelRef;
}
