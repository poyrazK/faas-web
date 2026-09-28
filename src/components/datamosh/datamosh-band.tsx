import { useEffect, useRef } from 'react';
import { Datamosh } from './engine';

/**
 * The datamosh decode as a band, for use as a transition.
 *
 * Mounting starts it and unmounting tears it down, so the caller controls the
 * run purely by rendering it or not. It additionally pauses when scrolled out
 * of view or when the tab is hidden, because an rAF loop painting a few
 * hundred rects a frame has no business running where nobody can see it.
 *
 * Marked `aria-hidden`: this is a wait, not a picture. A screen reader wants
 * the status line that accompanies it — "Reading owner/repo…" — not a
 * description of falling colour, so the caller owns the live region.
 */
export function DatamoshBand({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let engine: Datamosh | null = null;
    let raf = 0;
    let created = false;
    let onScreen = false;
    let hidden = document.hidden;

    const sync = () => {
      if (!engine || reduced) return;
      if (onScreen && !hidden) engine.start();
      else engine.stop();
    };

    const create = () => {
      if (created) return;
      created = true;
      // Deferred a frame so the host has been laid out and `measure()` reads a
      // real width; at zero width the column edges all collapse to 0.
      raf = requestAnimationFrame(() => {
        if (!hostRef.current) return;
        engine = new Datamosh(host, 1 + Math.floor(Math.random() * 9999));
        if (!engine.ok) return;
        if (reduced) engine.renderStill();
        else sync();
      });
    };

    const io = new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting);
        if (onScreen && !created) create();
        if (created) sync();
      },
      { rootMargin: '200px' }
    );
    io.observe(host);

    const onVisibility = () => {
      hidden = document.hidden;
      sync();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      if (raf) cancelAnimationFrame(raf);
      engine?.destroy();
      engine = null;
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={`relative aspect-[1344/620] w-full overflow-hidden rounded-lg bg-muted ${className ?? ''}`}
    />
  );
}
