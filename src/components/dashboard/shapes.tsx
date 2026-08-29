import { cn } from '@/lib/utils';

/**
 * The overview's colophon: three generative pattern panels after the
 * fashion of Book of Shapes (bookofshapes.com, Nikolaj Sokolowski) —
 * a flow-dot field, an arc truchet, and radial arcs — redrawn here as
 * deterministic SVG in the console's tokens rather than pasted exports.
 *
 * Deterministic on purpose: a seeded PRNG generates identical geometry on
 * every render, so prerender and hydration agree and the page's footer is
 * a fixed piece of the design, not a slot machine. Pure ornament —
 * aria-hidden, greys carry the pattern, mint falls where the wind enters.
 */

/** mulberry32 — tiny seeded PRNG, enough randomness for ornament. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GREY = 'color-mix(in oklab, var(--foreground) 22%, transparent)';
const GREY_SOFT = 'color-mix(in oklab, var(--foreground) 11%, transparent)';
const MINT = 'var(--brand-fill)';

/* ------------------------------------------------------------------ *
 * Flow Dots — a dot grid displaced by a flow field, drifting northeast
 * ------------------------------------------------------------------ */

function FlowDots() {
  const rand = rng(7);
  const dots: { x: number; y: number; r: number; mint: boolean; o: number }[] = [];
  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 22; gx++) {
      const u = gx / 21;
      const v = gy / 6;
      // The field: a gentle swirl, displacement growing toward the northeast.
      const angle = Math.sin(u * 4.2 + v * 2.1) * 1.6 + Math.cos(v * 3.4 - u * 1.3);
      const push = 3.5 + 5 * (u * 0.5 + (1 - v) * 0.5);
      dots.push({
        x: 8 + gx * 13 + Math.cos(angle) * push,
        y: 10 + gy * 13 + Math.sin(angle) * push,
        r: 1 + rand() * 1.4,
        mint: rand() < 0.14 * (0.4 + u * (1 - v)),
        o: 0.35 + rand() * 0.65,
      });
    }
  }
  return (
    <svg viewBox="0 0 296 100" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.r}
          fill={d.mint ? MINT : GREY}
          opacity={d.mint ? 0.9 : d.o}
        />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Arc Truchet — quarter-circle tiles, orientation by coin toss
 * ------------------------------------------------------------------ */

function ArcTruchet() {
  const rand = rng(21);
  const T = 33; // tile size
  const tiles: { x: number; y: number; flip: boolean; mint: boolean }[] = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 9; gx++) {
      tiles.push({ x: gx * T, y: gy * T, flip: rand() < 0.5, mint: rand() < 0.08 });
    }
  }
  const h = T / 2;
  return (
    <svg viewBox="0 0 297 99" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {tiles.map(({ x, y, flip, mint }, i) => {
        const stroke = mint ? MINT : GREY;
        // Two opposite quarter-circles per tile; flipping the pair is what
        // makes neighbouring tiles weave into continuous paths.
        const d = flip
          ? `M ${x + h} ${y} A ${h} ${h} 0 0 1 ${x} ${y + h} M ${x + h} ${y + T} A ${h} ${h} 0 0 0 ${x + T} ${y + h}`
          : `M ${x + h} ${y} A ${h} ${h} 0 0 0 ${x + T} ${y + h} M ${x + h} ${y + T} A ${h} ${h} 0 0 1 ${x} ${y + h}`;
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke={stroke}
            strokeWidth={mint ? 1.4 : 1}
            opacity={mint ? 0.9 : 0.75}
          />
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Radial Arcs — concentric dashed arcs rising from the base line
 * ------------------------------------------------------------------ */

function RadialArcs() {
  const rand = rng(42);
  const arcs: { r: number; dash: string; mint: boolean; o: number }[] = [];
  for (let i = 0; i < 9; i++) {
    const r = 12 + i * 10.5;
    const dash =
      rand() < 0.45 ? `${2 + Math.round(rand() * 5)} ${3 + Math.round(rand() * 6)}` : 'none';
    arcs.push({ r, dash, mint: i === 5, o: 0.4 + rand() * 0.5 });
  }
  return (
    <svg viewBox="0 0 296 100" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      {arcs.map((a, i) => (
        <path
          key={i}
          d={`M ${148 - a.r} 100 A ${a.r} ${a.r} 0 0 1 ${148 + a.r} 100`}
          fill="none"
          stroke={a.mint ? MINT : GREY}
          strokeWidth={a.mint ? 1.4 : 1}
          strokeDasharray={a.dash === 'none' ? undefined : a.dash}
          opacity={a.mint ? 0.9 : a.o}
        />
      ))}
      <line x1="24" y1="99.5" x2="272" y2="99.5" stroke={GREY_SOFT} strokeWidth="1" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Flow Dots at viewport scale — the page's background
 * ------------------------------------------------------------------ */

/**
 * The colophon's flow-dot field grown to cover the page: the same swirl,
 * displacement and mint bias gathering toward the northeast, at a fraction
 * of the foreground opacity so the data always wins. Deterministic like
 * the band, and a static SVG — no loop, no canvas, nothing to pause.
 */
export function FlowDotsField({ className }: { className?: string }) {
  const rand = rng(11);
  const dots: { x: number; y: number; r: number; mint: boolean; o: number }[] = [];
  for (let gy = 0; gy < 30; gy++) {
    for (let gx = 0; gx < 48; gx++) {
      const u = gx / 47;
      const v = gy / 29;
      const angle = Math.sin(u * 5.1 + v * 2.4) * 1.6 + Math.cos(v * 3.8 - u * 1.7);
      const push = 4 + 9 * (u * 0.5 + (1 - v) * 0.5);
      const ne = u * (1 - v);
      dots.push({
        x: 15 + gx * 30 + Math.cos(angle) * push,
        y: 15 + gy * 30 + Math.sin(angle) * push,
        r: 1.1 + rand() * 1.5,
        mint: rand() < 0.1 * (0.25 + ne * 1.5),
        o: 0.35 + rand() * 0.65,
      });
    }
  }
  return (
    <svg
      viewBox="0 0 1440 900"
      // Anchored to its own bottom edge: in a short strip along the page's
      // base, the field's lower band is what shows.
      preserveAspectRatio="xMidYMax slice"
      aria-hidden
      className={cn('h-full w-full', className)}
    >
      {dots.map((d, i) => (
        <circle
          key={i}
          cx={d.x}
          cy={d.y}
          r={d.r}
          fill={d.mint ? MINT : GREY_SOFT}
          opacity={d.mint ? 0.5 : d.o * 0.8}
        />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * The band
 * ------------------------------------------------------------------ */

export function ShapesBand({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('grid grid-cols-3 items-end gap-6 sm:gap-10', className)}
      style={{ height: 100 }}
    >
      <FlowDots />
      <ArcTruchet />
      <RadialArcs />
    </div>
  );
}
