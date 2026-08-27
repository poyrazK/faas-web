import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { Heading } from '@/lib/docs-content';

/**
 * The on-page contents, tracking reading position.
 *
 * Active is resolved from live geometry — the last heading above a reading
 * line a third of the way down the viewport — the same way the site nav
 * resolves its section dot, rather than from IntersectionObserver entries,
 * which only report the elements that changed.
 *
 * The indicator is a mint segment sliding along the hairline rail: the nav
 * capsule's position dot again, stretched to the height of a line. One
 * wayfinding instrument, three scales — nav, sidebar, and here.
 */
export function OnThisPage({ headings }: { headings: Heading[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const targets = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;

    const resolve = () => {
      const line = window.innerHeight * 0.3;
      let current: string | null = null;
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= line) current = target.id;
      }
      setActive(current ?? targets[0].id);
    };

    // The first resolve waits a frame: fonts and layout are still settling at
    // effect time, and the deferred read sees the geometry readers see.
    const raf = requestAnimationFrame(resolve);
    window.addEventListener('scroll', resolve, { passive: true });
    window.addEventListener('resize', resolve);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', resolve);
      window.removeEventListener('resize', resolve);
    };
  }, [headings]);

  return (
    <nav aria-label="On this page" className="hidden w-48 shrink-0 xl:block">
      <div className="sticky top-24">
        <h2 className="label-mono text-muted-foreground">On this page</h2>
        <ul className="mt-3 flex flex-col border-l border-border">
          {headings.map((h) => {
            const isActive = active === h.id;
            return (
              <li key={h.id} className="relative">
                {isActive && (
                  <motion.span
                    layoutId="docs-toc-active"
                    aria-hidden
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                    className="absolute -left-[1.5px] bottom-1.5 top-1.5 w-0.5 rounded-full bg-brand-fill"
                  />
                )}
                <a
                  href={`#${h.id}`}
                  aria-current={isActive ? 'location' : undefined}
                  className={`block py-1 pr-2 text-xs leading-relaxed transition-colors ${
                    h.level === 3 ? 'pl-6' : 'pl-4'
                  } ${isActive ? 'text-brand' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {h.text}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
