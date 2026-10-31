// Pillars — a Texture by Textures · https://textures.dev/s/pillars
// Install another: npx shadcn@latest add https://textures.dev/r/<slug>.json
// For agents: https://textures.md
// License: free to use
'use client';
import { type CSSProperties, useEffect, useRef } from 'react';
function selfSize(root: HTMLElement | null): void {
  const host = root?.parentElement;
  if (!root || !host || host.getBoundingClientRect().height > 0) return;
  root.style.minHeight = '240px';
}
type Pointer = { x: number; y: number; active: number; reduced: boolean };
const AMBIENT_SPEED = 1.5;
const AMBIENT_CYCLE = 4.5;
type EngineOptions = { ambientSpeed?: number };
function engine(
  root: HTMLElement,
  draw: (p: Pointer, dt: number) => boolean | void,
  min: [number, number],
  options: EngineOptions = {}
): () => void {
  const svg = root.querySelector('svg');
  if (!svg) return () => {};
  const mq = () =>
    matchMedia('(prefers-reduced-motion: reduce)').matches || matchMedia('(update: slow)').matches;
  const touchMq = matchMedia('(hover: none), (pointer: coarse)');
  const forced = () => root.closest('[data-motion]')?.getAttribute('data-motion') ?? null;
  const wantsAmbient = () => (forced() ? forced() === 'ambient' : touchMq.matches);
  const speed = AMBIENT_SPEED * (options.ambientSpeed ?? 1);
  const w = (2 * Math.PI) / AMBIENT_CYCLE;
  const phase = Math.random() * 2 * Math.PI;
  let onScreen = false;
  let ambient = false;
  let clock = 0;
  let hold = 0;
  let box: { left: number; top: number; s: number; ox: number; oy: number } | null = null;
  let px = 366;
  let py = 258;
  let cx = 0;
  let cy = 0;
  let active = 0;
  let target = 0;
  let vel = 0;
  let frame = 0;
  let last = 0;
  let lastMoveAt = 0;
  const measure = () => {
    const r = svg.getBoundingClientRect();
    if (r.width < min[0] || r.height < min[1]) {
      box = null;
      return;
    }
    const s = Math.max(r.width / 732, r.height / 516);
    box = {
      left: r.left,
      top: r.top,
      s,
      ox: (r.width - 732 * s) / 2,
      oy: (r.height - 516 * s) / 2,
    };
  };
  const tick = (now: number) => {
    const dt = Math.min(last ? (now - last) / 1000 : 1 / 60, 1 / 30);
    last = now;
    let moving = false;
    const reduced = mq();
    if (ambient && now > hold) {
      if (reduced) target = 0;
      else {
        clock += dt * speed;
        const t = clock;
        px =
          366 + 366 * (0.76 * Math.sin(w * t + phase) + 0.2 * Math.sin(1.93 * w * t + 1.2 + phase));
        py =
          258 +
          258 *
            (0.72 * Math.sin(0.75 * w * t + 0.8 + phase) +
              0.2 * Math.sin(1.37 * w * t + 2.1 + phase));
        target = 1;
        moving = true;
      }
    }
    if (reduced) {
      active = target;
      vel = 0;
    } else {
      const decay = Math.exp(-30 * dt);
      const off = active - target;
      const lead = vel + 30 * off;
      active = target + (off + lead * dt) * decay;
      vel = (vel - 30 * lead * dt) * decay;
      if (Math.abs(vel) < 0.02 && Math.abs(active - target) < 0.02) {
        active = target;
        vel = 0;
      } else moving = true;
    }
    const more = draw({ x: px, y: py, active, reduced }, dt);
    if (moving || more) frame = requestAnimationFrame(tick);
    else {
      frame = 0;
      last = 0;
    }
  };
  const wake = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const touchIsAmbient = (e: Event) =>
    (e as PointerEvent).pointerType === 'touch' && touchMq.matches;
  const onEnter = (e: PointerEvent) => {
    if (touchIsAmbient(e)) return;
    measure();
  };
  const onMove = (e: PointerEvent) => {
    if (touchIsAmbient(e)) return;
    const t = performance.now();
    if (!box || t - lastMoveAt > 250) measure();
    lastMoveAt = t;
    if (!box) return;
    if (!e.isTrusted) hold = performance.now() + 1000;
    cx = e.clientX;
    cy = e.clientY;
    px = (cx - box.left - box.ox) / box.s;
    py = (cy - box.top - box.oy) / box.s;
    target = 1;
    wake();
  };
  const onLeave = (e?: Event) => {
    if (e && touchIsAmbient(e)) return;
    if (e && !e.isTrusted) hold = 0;
    if (ambient && performance.now() > hold) return;
    target = 0;
    wake();
  };
  const onFocus = () => {
    measure();
    if (!box) return;
    px = 366;
    py = 258;
    target = 1;
    wake();
  };
  const onResize = () => {
    if (box || ambient) measure();
    if (ambient && !box) ambient = false;
    settle();
  };
  const onScroll = () => {
    if (!box || target !== 1 || (ambient && performance.now() > hold)) return;
    measure();
    if (!box) return;
    px = (cx - box.left - box.ox) / box.s;
    py = (cy - box.top - box.oy) / box.s;
    wake();
  };
  const settle = () => {
    const next = onScreen && !document.hidden && wantsAmbient();
    if (next === ambient) return;
    ambient = next;
    if (ambient) {
      measure();
      if (!box) {
        ambient = false;
        return;
      }
      wake();
    } else {
      target = 0;
      wake();
    }
  };
  const io =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          ([entry]) => {
            onScreen = !!entry?.isIntersecting;
            settle();
          },
          { threshold: 0.2 }
        )
      : null;
  io?.observe(svg);
  if (!io) {
    onScreen = true;
    settle();
  }
  const onVisibility = () => settle();
  const onCapability = () => settle();
  const reducedMq = matchMedia('(prefers-reduced-motion: reduce)');
  const onReduced = () => wake();
  document.addEventListener('visibilitychange', onVisibility);
  touchMq.addEventListener?.('change', onCapability);
  reducedMq.addEventListener?.('change', onReduced);
  const host: Element = root.closest('a, button, [tabindex]') ?? root.parentElement ?? root;
  root.addEventListener('pointerenter', onEnter);
  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerleave', onLeave);
  root.addEventListener('pointercancel', onLeave);
  host.addEventListener('focusin', onFocus);
  host.addEventListener('focusout', onLeave);
  window.addEventListener('resize', onResize, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  return () => {
    root.removeEventListener('pointerenter', onEnter);
    root.removeEventListener('pointermove', onMove);
    root.removeEventListener('pointerleave', onLeave);
    root.removeEventListener('pointercancel', onLeave);
    host.removeEventListener('focusin', onFocus);
    host.removeEventListener('focusout', onLeave);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener('visibilitychange', onVisibility);
    touchMq.removeEventListener?.('change', onCapability);
    reducedMq.removeEventListener?.('change', onReduced);
    io?.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
const W = 732;
const H = 516;
const COLS = 34;
const ROWS = 16;
const PX = 23.0941;
const PY = 33.4779;
const X0 = -27;
const X0_ODD = -15;
const Y0 = 0.74;
const BODY_X = 0.5;
const BODY_W = 23.094;
const BODY_Y = 6.748;
const BODY_H = 158.23;
const PEAK = 64;
const REACH = 5.2;
const CURVE = 1.5;
const TAU = 0.06;
export type PillarsProps = {
  tokens?: Partial<Record<'--texture-ink' | '--texture-field', string>>;
  className?: string;
  static?: boolean;
};
const N = COLS * ROWS;
const colX = (r: number, c: number) => (r % 2 ? X0_ODD : X0) + c * PX;
const cap = (x: number, y: number) =>
  `M${(x + 24.0941).toFixed(2)} ${(y + 6.17535).toFixed(2)}c0 3.41056-5.3936 6.17535-12.047 6.17535s-12.047-2.76479-12.047-6.17535 5.3936-6.17535 12.047-6.17535 12.047 2.76479 12.047 6.17535z`;
const body = (x: number, y: number) =>
  `M${(x + BODY_X).toFixed(2)} ${(y + BODY_Y).toFixed(2)}h${BODY_W.toFixed(3)}v${BODY_H.toFixed(2)}h-${BODY_W.toFixed(3)}z`;
const rowPaths = (r: number, lift: Float32Array) => {
  let b = '';
  let c = '';
  const y0 = Y0 + r * PY;
  for (let i = 0; i < COLS; i++) {
    const x = colX(r, i);
    const y = y0 - lift[r * COLS + i]!;
    b += body(x, y);
    c += cap(x, y);
  }
  return [b, c] as const;
};
const REST = Array.from({ length: ROWS }, (_, r) => rowPaths(r, new Float32Array(N)));
export function Pillars({ tokens, className = '', static: isStatic = false }: PillarsProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => selfSize(ref.current), []);
  const bodies = useRef<(SVGPathElement | null)[]>([]);
  const caps = useRef<(SVGPathElement | null)[]>([]);
  useEffect(() => {
    const root = ref.current;
    if (!root || isStatic) return;
    const lift = new Float32Array(N);
    const atRest = new Uint8Array(ROWS).fill(1);
    return engine(
      root,
      ({ x, y, active, reduced }, dt) => {
        const fx = x;
        const fy = y;
        let moving = false;
        const k = reduced ? 1 : 1 - Math.exp(-dt / TAU);
        for (let r = 0; r < ROWS; r++) {
          let rowMoving = false;
          let rowLifted = false;
          for (let i = 0; i < COLS; i++) {
            const j = r * COLS + i;
            const dx = (colX(r, i) + 12.047 - fx) / PX;
            const dy = (Y0 + r * PY + 6.175 - fy) / PY;
            const d = Math.hypot(dx, dy);
            const want = d >= REACH ? 0 : PEAK * active * Math.pow(1 - d / REACH, CURVE);
            let next = lift[j]! + (want - lift[j]!) * k;
            if (Math.abs(next - want) < 0.03) next = want;
            else rowMoving = true;
            lift[j] = next;
            if (next !== 0) rowLifted = true;
          }
          if (rowMoving) moving = true;
          const bEl = bodies.current[r];
          const cEl = caps.current[r];
          if (!bEl || !cEl) continue;
          if (!rowLifted) {
            if (!atRest[r]) {
              bEl.setAttribute('d', REST[r]![0]);
              cEl.setAttribute('d', REST[r]![1]);
              atRest[r] = 1;
            }
            continue;
          }
          if (rowMoving || atRest[r] || reduced) {
            const [b, c] = rowPaths(r, lift);
            bEl.setAttribute('d', b);
            cEl.setAttribute('d', c);
            atRest[r] = 0;
          }
        }
        return moving;
      },
      [160, 112]
    );
  }, [isStatic]);
  const style = {
    '--texture-ink': 'var(--foreground)',
    '--texture-field': 'var(--background)',
    ...tokens,
    color: 'var(--texture-ink)',
    background: 'var(--texture-field)',
  } as CSSProperties;
  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        isolation: 'isolate',
        height: '100%',
        width: '100%',
        overflow: 'clip',
        contain: 'layout paint style',
        containerType: 'size',
        ...style,
      }}
      data-texture="pillars"
      className={className}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        focusable="false"
        style={{ position: 'absolute', inset: 0, display: 'block', height: '100%', width: '100%' }}
      >
        {REST.map(([b, c], r) => (
          <g key={r}>
            <path
              ref={(el) => {
                bodies.current[r] = el;
              }}
              d={b}
              fill="var(--texture-field)"
              stroke="currentColor"
              strokeWidth={1}
            />
            <path
              ref={(el) => {
                caps.current[r] = el;
              }}
              d={c}
              fill="currentColor"
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
