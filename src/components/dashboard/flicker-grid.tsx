import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'motion/react';

/**
 * The console's ground: graph paper with a live current in it.
 *
 * A light grey grid (CSS, so the lines stay crisp at any DPI) whose cells
 * flicker in mint on a canvas aligned to the same pitch — sections of the
 * paper energising at random, weighted toward the northeast the gregale
 * blows from. Colours are read from the theme's custom properties at
 * mount, so the component stays inside the token system.
 *
 * Cheap on purpose: one 2D canvas, one rAF loop that sleeps when the tab
 * hides, instant opacity flips (that is what flicker is). Reduced motion
 * renders a single still frame.
 */

/** Grid pitch in px — cell plus its 1px line. */
const PITCH = 28;
/** Per-cell chance of flipping, per second. */
const FLICKER_CHANCE = 0.22;
const MAX_OPACITY = 0.16;

export function FlickerGrid({ className }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!host || !canvas || !ctx) return;

    // The theme's mint, resolved once — the canvas cannot read var() itself.
    const mint = getComputedStyle(host).getPropertyValue('--brand-fill').trim() || 'currentColor';

    let cols = 0;
    let rows = 0;
    let opacities = new Float32Array(0);
    let weights = new Float32Array(0);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const layout = () => {
      const { width, height } = host.getBoundingClientRect();
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      cols = Math.ceil(width / PITCH);
      rows = Math.ceil(height / PITCH);
      opacities = new Float32Array(cols * rows);
      weights = new Float32Array(cols * rows);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          // Northeast bias: the corner the wind enters from glows the most.
          const ne = (x / Math.max(cols - 1, 1)) * 0.5 + (1 - y / Math.max(rows - 1, 1)) * 0.5;
          weights[y * cols + x] = 0.3 + 0.7 * ne * ne;
        }
      }
      // Seed so the first frame is already alive, not a blank warming up.
      for (let i = 0; i < opacities.length; i++) {
        if (Math.random() < 0.35) opacities[i] = Math.random() * MAX_OPACITY * weights[i];
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = mint;
      const size = (PITCH - 1) * dpr;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const o = opacities[y * cols + x];
          if (o < 0.01) continue;
          ctx.globalAlpha = o;
          ctx.fillRect(x * PITCH * dpr + dpr, y * PITCH * dpr + dpr, size, size);
        }
      }
      ctx.globalAlpha = 1;
    };

    layout();
    draw();
    if (reduce) {
      // A still frame is the whole show under reduced motion.
      const onResize = () => {
        layout();
        draw();
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const chance = FLICKER_CHANCE * dt;
      for (let i = 0; i < opacities.length; i++) {
        if (Math.random() < chance) {
          opacities[i] = Math.random() < 0.75 ? Math.random() * MAX_OPACITY * weights[i] : 0;
        }
      }
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    const onResize = () => {
      layout();
      draw();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    };
  }, [reduce]);

  return (
    <div ref={hostRef} aria-hidden className={`pointer-events-none absolute ${className || 'inset-0'}`}>
      {/* The paper: light grey rules at the same pitch the cells flicker on,
          drawn in CSS so they stay hairline-crisp. */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            `repeating-linear-gradient(to right, color-mix(in oklab, var(--foreground) 7%, transparent) 0 1px, transparent 1px ${PITCH}px),` +
            `repeating-linear-gradient(to bottom, color-mix(in oklab, var(--foreground) 7%, transparent) 0 1px, transparent 1px ${PITCH}px)`,
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
