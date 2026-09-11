import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { EASE } from './motion';

/** One entrance per committed page, without keying/remounting the live outlet. */
export function ConsolePageTransition({
  children,
  pageKey,
}: {
  children: ReactNode;
  pageKey: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!element?.animate || preference.matches) return;

    // No persistent hidden state or forwards fill: late route chunks and data
    // remain visible, and transforms stop affecting sticky/fixed descendants
    // as soon as the entrance ends. A new navigation cancels the old motion.
    const animation = element.animate(
      [
        { opacity: 0.65, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 200, easing: `cubic-bezier(${EASE.join(',')})` }
    );
    const stopForReducedMotion = (event: MediaQueryListEvent) => {
      if (event.matches) animation.cancel();
    };
    preference.addEventListener('change', stopForReducedMotion);
    return () => {
      animation.cancel();
      preference.removeEventListener('change', stopForReducedMotion);
    };
  }, [pageKey]);

  return (
    <div ref={ref} className="console-page flex flex-col gap-6">
      {children}
    </div>
  );
}
