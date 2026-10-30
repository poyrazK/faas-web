import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { AppSource } from './new-app-source';
import './new-app-scenes.css';

/**
 * The New app source scenes: small isometric pictures of what each source
 * does, in the art palette on a dark screen.
 *
 *   Git        a repository's branch graph builds onto a live server
 *   Template   a starter kit, its last block dropping into place
 *   Empty      a footprint with nothing on it yet but an outline
 *   Container  an image's layers, opening apart and settling
 *   Worker     jobs queue into a machine that keeps running, and leave done
 *   Import     one repository becomes three services
 *
 * Shapes are boxes in isometric space, shaded per face in CSS from one tone,
 * so a scene names tokens and never a colour. A scene at rest shows its
 * composed frame; `active` (hovered, focused or selected) plays its loop.
 */

type Art =
  'slate' | 'mute' | 'light' | 'magenta' | 'cyan' | 'orange' | 'yellow' | 'lime' | 'blue' | 'pink';
type P = [number, number];
type V = [number, number, number];

const art = (name: Art) => `var(--art-${name})`;
const U = 8;
const COS = Math.sqrt(3) / 2;

/** Isometric space to the SVG's: x runs down-right, y down-left, z up. */
const pt = (x: number, y: number, z = 0): P => [(x - y) * COS * U, (x + y) * 0.5 * U - z * U];
const pts = (...p: P[]) => p.map(([a, b]) => `${a.toFixed(2)},${b.toFixed(2)}`).join(' ');
/** A move along the isometric axes, as the CSS translate a loop animates. */
const move = (dx: number, dy: number, dz = 0) => {
  const [a, b] = pt(dx, dy, dz);
  return { '--dx': `${a.toFixed(2)}px`, '--dy': `${b.toFixed(2)}px` } as CSSProperties;
};
const wait = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

function Box({
  at: [x, y, z],
  size: [w, d, h],
  tone,
  className,
  style,
  children,
}: {
  at: V;
  size: V;
  tone: Art;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <g className={cn('iso', className)} style={{ '--c': art(tone), ...style } as CSSProperties}>
      <polygon
        className="iso-l"
        points={pts(
          pt(x, y + d, z + h),
          pt(x + w, y + d, z + h),
          pt(x + w, y + d, z),
          pt(x, y + d, z)
        )}
      />
      <polygon
        className="iso-r"
        points={pts(
          pt(x + w, y, z + h),
          pt(x + w, y + d, z + h),
          pt(x + w, y + d, z),
          pt(x + w, y, z)
        )}
      />
      <polygon
        className="iso-t"
        points={pts(
          pt(x, y, z + h),
          pt(x + w, y, z + h),
          pt(x + w, y + d, z + h),
          pt(x, y + d, z + h)
        )}
      />
      {children}
    </g>
  );
}

/** The soft shadow a box casts on the floor. */
function Shadow({ at: [x, y], size: [w, d] }: { at: [number, number]; size: [number, number] }) {
  const o = 0.5;
  return (
    <polygon
      className="iso-shadow"
      points={pts(
        pt(x + o, y + o),
        pt(x + w + o, y + o),
        pt(x + w + o, y + d + o),
        pt(x + o, y + d + o)
      )}
    />
  );
}

/** A run of status lights along a box's left face (the one facing +y). */
function Lights({
  x,
  y,
  z,
  n,
  tone,
  blink,
}: {
  x: number;
  y: number;
  z: number;
  n: number;
  tone: Art;
  blink?: boolean;
}) {
  return (
    <g style={{ '--c': art(tone) } as CSSProperties}>
      {Array.from({ length: n }, (_, i) => (
        <polygon
          key={i}
          className={cn('iso-led', blink && 'a-blink')}
          style={blink ? wait(i * 220) : undefined}
          points={pts(
            pt(x + i * 0.9, y, z),
            pt(x + i * 0.9 + 0.55, y, z),
            pt(x + i * 0.9 + 0.55, y, z - 0.3),
            pt(x + i * 0.9, y, z - 0.3)
          )}
        />
      ))}
    </g>
  );
}

function Git() {
  return (
    <svg viewBox="-43 -17 158 111" preserveAspectRatio="xMidYMid meet">
      <Shadow at={[0, 0]} size={[6, 5]} />
      <Shadow at={[11, 0.5]} size={[5, 4]} />
      {/* The repository, its branch graph drawn on the lid. */}
      <Box at={[0, 0, 0]} size={[6, 5, 1.1]} tone="slate" />
      {/* main, and a branch that forks off it and merges back */}
      <polyline className="iso-line" points={pts(pt(0.6, 3.6, 1.1), pt(5.4, 3.6, 1.1))} />
      <polyline
        className="iso-line"
        points={pts(pt(1.9, 3.6, 1.1), pt(1.9, 1.6, 1.1), pt(4.3, 1.6, 1.1), pt(4.3, 3.6, 1.1))}
      />
      <Box at={[0.75, 3.3, 1.1]} size={[0.6, 0.6, 0.45]} tone="orange" />
      <Box at={[2.5, 1.3, 1.1]} size={[0.6, 0.6, 0.45]} tone="magenta" />
      <Box at={[3.4, 1.3, 1.1]} size={[0.6, 0.6, 0.45]} tone="magenta" />
      <Box at={[4.55, 3.3, 1.1]} size={[0.6, 0.6, 0.45]} tone="cyan" />
      {/* The build travels to the server. */}
      <polyline className="iso-wire a-march" points={pts(pt(6, 2.5), pt(11, 2.5))} />
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          className="a-travel"
          style={{ ...move(4, 0), ...wait(i * 700) }}
          at={[6.3, 2.05, 0]}
          size={[0.9, 0.9, 0.9]}
          tone="orange"
        />
      ))}
      {/* The server it lands on, live. */}
      <Box at={[11, 0.5, 0]} size={[5, 4, 1.5]} tone="slate" />
      <Lights x={11.6} y={4.5} z={1.05} n={4} tone="lime" blink />
      <Box at={[11, 0.5, 1.5]} size={[5, 4, 1.5]} tone="slate" />
      <Lights x={11.6} y={4.5} z={2.55} n={4} tone="lime" blink />
      <Box className="a-blink" at={[13, 2, 3]} size={[1, 1, 0.3]} tone="lime" />
    </svg>
  );
}

function Template() {
  const slots: { i: number; j: number; tone: Art }[] = [
    { i: 0, j: 0, tone: 'yellow' },
    { i: 1, j: 0, tone: 'lime' },
    { i: 2, j: 0, tone: 'cyan' },
    { i: 0, j: 1, tone: 'magenta' },
    { i: 1, j: 1, tone: 'orange' },
  ];
  return (
    <svg viewBox="-43 -19 99 79" preserveAspectRatio="xMidYMid meet">
      <Shadow at={[0, 0]} size={[7, 5]} />
      <Box at={[0, 0, 0]} size={[7, 5, 0.7]} tone="slate" />
      {slots.map((s) => (
        <Box
          key={`${s.i}${s.j}`}
          at={[0.6 + s.i * 2.2, 0.5 + s.j * 2.2, 0.7]}
          size={[1.7, 1.7, 1.2]}
          tone={s.tone}
        />
      ))}
      {/* The last block of the kit, dropping into its slot. */}
      <Box
        className="a-drop"
        at={[0.6 + 2 * 2.2, 0.5 + 2.2, 0.7]}
        size={[1.7, 1.7, 1.2]}
        tone="blue"
      />
    </svg>
  );
}

function Empty() {
  const [x, y, z, s, h] = [0.7, 0.7, 1.2, 3.6, 2.6];
  const c: Record<string, P> = {
    a: pt(x, y, z),
    b: pt(x + s, y, z),
    c: pt(x + s, y + s, z),
    d: pt(x, y + s, z),
    A: pt(x, y, z + h),
    B: pt(x + s, y, z + h),
    C: pt(x + s, y + s, z + h),
    D: pt(x, y + s, z + h),
  };
  const edges = ['ab', 'bc', 'cd', 'da', 'AB', 'BC', 'CD', 'DA', 'aA', 'bB', 'cC', 'dD'];
  return (
    <svg viewBox="-43 -37 85 89" preserveAspectRatio="xMidYMid meet">
      <Shadow at={[0, 0]} size={[5, 5]} />
      <Box at={[0, 0, 0]} size={[5, 5, 0.25]} tone="slate" />
      <polyline className="iso-line" points={pts(pt(2.1, 2.5, 0.25), pt(2.9, 2.5, 0.25))} />
      <polyline className="iso-line" points={pts(pt(2.5, 2.1, 0.25), pt(2.5, 2.9, 0.25))} />
      {/* What will be here: only an outline so far. */}
      <g className="a-float">
        {edges.map((e) => (
          <line
            key={e}
            className="iso-wire a-march"
            x1={c[e[0]][0]}
            y1={c[e[0]][1]}
            x2={c[e[1]][0]}
            y2={c[e[1]][1]}
          />
        ))}
      </g>
    </svg>
  );
}

function Container() {
  const layers: { z: number; tone: Art; lift: number }[] = [
    { z: 0, tone: 'blue', lift: 0 },
    { z: 1.1, tone: 'cyan', lift: 0.9 },
    { z: 2.2, tone: 'light', lift: 1.8 },
  ];
  return (
    <svg viewBox="-43 -32 85 84" preserveAspectRatio="xMidYMid meet">
      <Shadow at={[0, 0]} size={[5, 5]} />
      {layers.map((l) => (
        <Box
          key={l.tone}
          className="a-lift"
          style={move(0, 0, l.lift)}
          at={[0, 0, l.z]}
          size={[5, 5, 0.8]}
          tone={l.tone}
        />
      ))}
      {/* The digest it is pinned by, as a tag on the image. */}
      <Box at={[3.4, 5, 2.5]} size={[1.4, 0.15, 0.35]} tone="orange" />
    </svg>
  );
}

function Worker() {
  // The lane runs straight across the screen: along x and against y.
  const lane = (t: number): V => [t, -t, 0];
  const [mx, my] = [5, -6.5];
  const r = 1.4;
  const [cx, cy] = pt(mx + 2.25, my + 2.25, 2.2);
  return (
    <svg viewBox="-14 -32 237 74" preserveAspectRatio="xMidYMid meet">
      <polyline className="iso-wire a-march" points={pts(pt(0.5, -0.5), pt(13.5, -13.5))} />
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          className="a-travel"
          style={{ ...move(3, -3), ...wait(i * 800) }}
          at={lane(i * 1.3)}
          size={[0.9, 0.9, 0.9]}
          tone="magenta"
        />
      ))}
      <Shadow at={[mx, my]} size={[4.5, 4.5]} />
      <Box at={[mx, my, 0]} size={[4.5, 4.5, 2.2]} tone="slate" />
      <Lights x={mx + 0.6} y={my + 4.5} z={1.6} n={4} tone="lime" blink />
      {/* It keeps running: a light circling the lid. */}
      <ellipse
        className="iso-line"
        cx={cx}
        cy={cy}
        rx={1.2247 * r * U}
        ry={0.7071 * r * U}
        fill="none"
      />
      <g transform={`translate(${cx} ${cy}) scale(1 0.5774)`}>
        <g className="a-orbit">
          <circle cx={1.2247 * r * U} cy={0} r={2.2} fill={art('lime')} />
        </g>
      </g>
      {[0, 1].map((i) => (
        <Box
          key={i}
          className="a-travel"
          style={{ ...move(3, -3), ...wait(400 + i * 800) }}
          at={lane(11 + i * 1.3)}
          size={[0.7, 0.7, 0.7]}
          tone="lime"
        />
      ))}
    </svg>
  );
}

function Import() {
  // The services stand in a row straight across the screen, on the lane that
  // leaves the middle of the repository's right face (x + y = 5.5).
  const services: { t: number; tone: Art }[] = [
    { t: 9, tone: 'cyan' },
    { t: 12.5, tone: 'magenta' },
    { t: 16, tone: 'yellow' },
  ];
  const lane = 2.9;
  return (
    <svg viewBox="-25 -31 273 75" preserveAspectRatio="xMidYMid meet">
      <polyline
        className="iso-wire a-march"
        points={pts(pt(5.5, 0), pt(16 + 1.3, -16 + lane + 1.3))}
      />
      <Shadow at={[0, -2.5]} size={[5.5, 5]} />
      {/* One repository, its services still inside it. */}
      <Box at={[0, -2.5, 0]} size={[5.5, 5, 1.6]} tone="slate" />
      {(['cyan', 'magenta', 'yellow'] as const).map((tone, i) => (
        <Box key={tone} at={[0.6 + i * 1.6, -2, 1.6]} size={[1.2, 4, 0.3]} tone={tone} />
      ))}
      {services.map((s, i) => (
        <g key={s.tone}>
          <Shadow at={[s.t, -s.t + lane]} size={[2.6, 2.6]} />
          <Box
            className="a-rise"
            style={wait(300 + i * 220)}
            at={[s.t, -s.t + lane, 0]}
            size={[2.6, 2.6, 1.8]}
            tone={s.tone}
          >
            <Lights x={s.t + 0.5} y={-s.t + lane + 2.6} z={1.3} n={2} tone="lime" />
          </Box>
        </g>
      ))}
    </svg>
  );
}

const SCENES: Record<AppSource, () => ReactNode> = {
  git: Git,
  template: Template,
  empty: Empty,
  container: Container,
  worker: Worker,
  import: Import,
};

export function SourceScene({ id, active }: { id: AppSource; active: boolean }) {
  const Scene = SCENES[id];
  return (
    <div
      aria-hidden="true"
      className="nab-preview nab-scene"
      data-preview={id}
      data-active={active ? '' : undefined}
    >
      <Scene />
    </div>
  );
}

// Four-by-four pixel glyphs for Fold's strip.
const GLYPHS: Record<AppSource, { color: Art; rows: string[] }> = {
  git: { color: 'orange', rows: ['x..x', 'x.x.', 'xx..', 'x...'] },
  template: { color: 'yellow', rows: ['x.x.', '.x.x', 'x.x.', '.x.x'] },
  empty: { color: 'magenta', rows: ['x..x', '....', '....', 'x..x'] },
  container: { color: 'lime', rows: ['xxxx', '....', 'xxxx', '....'] },
  worker: { color: 'cyan', rows: ['.xx.', 'x..x', 'x..x', '.xx.'] },
  import: { color: 'blue', rows: ['x...', 'xxx.', 'x..x', '...x'] },
};

export function SourceGlyph({ id }: { id: AppSource }) {
  const { color, rows } = GLYPHS[id];
  return (
    <svg aria-hidden="true" viewBox="-1 -1 6 6" className="nab-glyph" data-source={id}>
      {rows.flatMap((row, y) =>
        [...row].map((ch, x) =>
          ch === 'x' ? (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={art(color)} />
          ) : null
        )
      )}
    </svg>
  );
}
