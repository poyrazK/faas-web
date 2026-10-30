import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  type MotionValue,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'motion/react';

export const VIEW_W = 420;
export const VIEW_H = 200;
const REST_X = VIEW_W / 2;
const REST_Y = VIEW_H / 2;
// Tuned to settle like Pillars, the texture these figures sit beside.
const POINTER_SPRING = { stiffness: 300, damping: 30 };
const ACTIVE_SPRING = { stiffness: 400, damping: 40 };
const COARSE = '(hover: none), (pointer: coarse)';
// Pillars' ambient path, so touch screens drift the same way.
const DRIFT_SPEED = 1.5;
const DRIFT_W = (2 * Math.PI) / 4.5;
const REMEASURE_MS = 250;

export type FigureState = {
  /** Pointer x in the 420 × 200 frame, spring-smoothed. */
  px: MotionValue<number>;
  /** Pointer y in the 420 × 200 frame, spring-smoothed. */
  py: MotionValue<number>;
  /** 0 at rest, 1 while the figure is acted on, spring-settled. */
  active: MotionValue<number>;
  /** The unsmoothed input behind the springs. */
  pointer: { x: MotionValue<number>; y: MotionValue<number>; target: MotionValue<number> };
  reduced: boolean;
};

const FigureContext = createContext<FigureState | null>(null);

export function useFigure(): FigureState {
  const state = useContext(FigureContext);
  if (!state) throw new Error('useFigure must be used inside a FigureFrame');
  return state;
}

/** Maps a client point into the frame under `xMidYMid meet`, clamped to it. */
export function toFigure(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): [number, number] | null {
  const s = Math.min(rect.width / VIEW_W, rect.height / VIEW_H);
  if (!(s > 0)) return null;
  const x = (clientX - rect.left - (rect.width - VIEW_W * s) / 2) / s;
  const y = (clientY - rect.top - (rect.height - VIEW_H * s) / 2) / s;
  return [Math.min(VIEW_W, Math.max(0, x)), Math.min(VIEW_H, Math.max(0, y))];
}

/**
 * The shared stage for a Hosting figure: a 200px-tall, decorative SVG whose
 * pointer becomes motion values. Figures derive their attributes from those
 * values with `useTransform`, so moving the pointer never renders React.
 */
export function FigureFrame({ name, children }: { name: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = Boolean(useReducedMotion());
  const x = useMotionValue(REST_X);
  const y = useMotionValue(REST_Y);
  const target = useMotionValue(0);
  const px = useSpring(x, POINTER_SPRING);
  const py = useSpring(y, POINTER_SPRING);
  const active = useSpring(target, ACTIVE_SPRING);
  const inView = useInView(ref, { amount: 0.2 });
  const [coarse, setCoarse] = useState(false);
  const rect = useRef<DOMRect | null>(null);
  const measuredAt = useRef(0);

  const state = useMemo<FigureState>(
    () => ({ px, py, active, pointer: { x, y, target }, reduced }),
    [px, py, active, x, y, target, reduced]
  );

  useEffect(() => {
    const query = matchMedia(COARSE);
    const sync = () => setCoarse(query.matches);
    sync();
    query.addEventListener?.('change', sync);
    return () => query.removeEventListener?.('change', sync);
  }, []);

  // Keyboard focus on the detail panel wakes the figure from its centre.
  useEffect(() => {
    const root = ref.current;
    if (!root || reduced) return;
    const host = root.closest('[tabindex]') ?? root.parentElement ?? root;
    const onFocus = () => {
      x.set(REST_X);
      y.set(REST_Y);
      target.set(1);
    };
    const onBlur = () => target.set(0);
    host.addEventListener('focusin', onFocus);
    host.addEventListener('focusout', onBlur);
    return () => {
      host.removeEventListener('focusin', onFocus);
      host.removeEventListener('focusout', onBlur);
    };
  }, [reduced, x, y, target]);

  // Touch screens have no hover, so the figure acts on itself while in view.
  const drifting = !reduced && coarse && inView;
  useEffect(() => {
    if (!drifting) return;
    const phase = Math.random() * 2 * Math.PI;
    let clock = 0;
    let last = 0;
    let frame = 0;
    const tick = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
      last = now;
      clock += dt * DRIFT_SPEED;
      const t = clock;
      x.set(
        REST_X +
          REST_X *
            (0.76 * Math.sin(DRIFT_W * t + phase) +
              0.2 * Math.sin(1.93 * DRIFT_W * t + 1.2 + phase))
      );
      y.set(
        REST_Y +
          REST_Y *
            (0.72 * Math.sin(0.75 * DRIFT_W * t + 0.8 + phase) +
              0.2 * Math.sin(1.37 * DRIFT_W * t + 2.1 + phase))
      );
      target.set(1);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      target.set(0);
    };
  }, [drifting, x, y, target]);

  const ignore = (e: PointerEvent) => reduced || (coarse && e.pointerType === 'touch');
  const measure = () => {
    if (!ref.current) return;
    rect.current = ref.current.getBoundingClientRect();
    measuredAt.current = performance.now();
  };
  const onPointerEnter = (e: PointerEvent) => {
    if (!ignore(e)) measure();
  };
  const onPointerMove = (e: PointerEvent) => {
    if (ignore(e)) return;
    if (!rect.current || performance.now() - measuredAt.current > REMEASURE_MS) measure();
    const point = rect.current && toFigure(e.clientX, e.clientY, rect.current);
    if (!point) return;
    x.set(point[0]);
    y.set(point[1]);
    target.set(1);
  };
  const onPointerLeave = (e: PointerEvent) => {
    if (!ignore(e)) target.set(0);
  };

  return (
    <FigureContext.Provider value={state}>
      <div
        ref={ref}
        data-figure={name}
        className="feature-figure"
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerCancel={onPointerLeave}
      >
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
          focusable="false"
          fill="none"
          stroke="var(--brand)"
          strokeWidth={1}
        >
          {children}
        </svg>
      </div>
    </FigureContext.Provider>
  );
}
