import { useId, type CSSProperties, type ReactNode } from 'react';
import type { AppSource } from './new-app-source';
import './new-app-scenes.css';

/**
 * The New app source scenes, drawn after a motion reel: flat, hard-edged
 * geometry in signal colours on a dark screen, with hairline guides and
 * motion that snaps on a beat. Each source borrows one of the reel's motifs:
 *
 *   Git        a trunk with branches bursting off it, and a merged asterisk
 *   Template   a checker grid of colour that fills in on a wave
 *   Empty      a dot matrix, densest at its centre, breathing outward
 *   Container  a pillar: a core in a ring of layers, wired to its corners
 *   Worker     three spinners that never stop
 *   Import     a repository scanned, then split into three services
 *
 * A scene at rest shows its composed frame; `active` (hovered, focused or
 * selected) plays its loop, which starts and ends on that frame (Git's commit
 * alone restarts from the top). Colours are
 * the art tokens in `index.css`, so no colour is written here.
 */

type Art = 'mute' | 'light' | 'magenta' | 'cyan' | 'orange' | 'yellow' | 'lime' | 'blue' | 'pink';

const art = (name: Art) => `var(--art-${name})`;
const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

/** A bar `length` long that ends at (x, y), pointing left, turned by `turn` degrees. */
function Branch({
  x,
  y,
  length,
  turn,
  color,
  wait,
}: {
  x: number;
  y: number;
  length: number;
  turn: number;
  color: Art;
  wait: number;
}) {
  return (
    <g transform={`rotate(${turn} ${x} ${y})`}>
      <rect
        className="a-grow"
        style={delay(wait)}
        x={x - length}
        y={y - 3.5}
        width={length}
        height={7}
        fill={art(color)}
      />
    </g>
  );
}

function Git() {
  const trunk = 150;
  // Three bursts off the trunk; the middle one carries the merged branch.
  const bursts: { y: number; bars: [Art, number, number][] }[] = [
    {
      y: 44,
      bars: [
        ['magenta', 45, 46],
        ['yellow', 0, 44],
        ['blue', -45, 46],
      ],
    },
    {
      y: 90,
      bars: [
        ['orange', 45, 40],
        ['magenta', 0, 48],
        ['yellow', -45, 40],
      ],
    },
    {
      y: 136,
      bars: [
        ['magenta', 45, 46],
        ['yellow', 0, 44],
        ['blue', -45, 46],
      ],
    },
  ];
  return (
    <svg viewBox="4 0 180 180" preserveAspectRatio="xMidYMid meet">
      <g className="a-spin" style={delay(500)}>
        <rect x={68 - 3.5} y={56} width={7} height={68} fill={art('orange')} />
        <rect x={34} y={90 - 3.5} width={68} height={7} fill={art('yellow')} />
        <rect
          x={34}
          y={90 - 3.5}
          width={68}
          height={7}
          fill={art('magenta')}
          transform="rotate(45 68 90)"
        />
        <rect
          x={34}
          y={90 - 3.5}
          width={68}
          height={7}
          fill={art('blue')}
          transform="rotate(-45 68 90)"
        />
      </g>
      {bursts.map((b, i) =>
        b.bars.map(([color, turn, length], j) => (
          <Branch
            key={`${i}-${j}`}
            x={trunk}
            y={b.y}
            length={length}
            turn={turn}
            color={color}
            wait={i * 160 + j * 60}
          />
        ))
      )}
      <rect x={trunk - 4} y={14} width={8} height={52} fill={art('orange')} />
      <rect x={trunk - 4} y={66} width={8} height={48} fill={art('blue')} />
      <rect x={trunk - 4} y={114} width={8} height={52} fill={art('orange')} />
      {/* A commit lands on the trunk, step by step. */}
      <rect className="a-drop" x={trunk - 6} y={14} width={12} height={12} fill={art('light')} />
    </svg>
  );
}

// Seven columns by five rows; '.' is a gap. The reel's checker, re-coloured.
const CHECKER = ['.y.m.o.', 'l.o.m.c', '.c.l.y.', 'y.m.b.c', '.o.y.m.'];
const LETTER: Record<string, Art> = {
  y: 'yellow',
  m: 'magenta',
  o: 'orange',
  l: 'lime',
  c: 'cyan',
  b: 'blue',
};

function Template() {
  const size = 18;
  const x0 = 37;
  const y0 = 25;
  return (
    <svg viewBox="0 0 200 140" preserveAspectRatio="xMidYMid meet">
      <rect
        x={25.5}
        y={15.5}
        width={149}
        height={109}
        fill="none"
        stroke={art('mute')}
        strokeWidth={0.75}
      />
      {/* Ticks on the frame, the colour of the cells they line up with. */}
      <rect x={x0 + size} y={14} width={size} height={2} fill={art('yellow')} />
      <rect x={x0 + 3 * size} y={14} width={size} height={2} fill={art('magenta')} />
      <rect x={x0 + size} y={124} width={size} height={2} fill={art('orange')} />
      <rect x={x0 + 3 * size} y={124} width={size} height={2} fill={art('yellow')} />
      <rect x={24} y={y0 + size} width={2} height={size} fill={art('lime')} />
      <rect x={174} y={y0 + 3 * size} width={2} height={size} fill={art('cyan')} />
      {CHECKER.flatMap((row, r) =>
        [...row].map((ch, c) =>
          ch === '.' ? null : (
            <rect
              key={`${r}-${c}`}
              className="a-pop"
              style={delay((r + c) * 70)}
              x={x0 + c * size}
              y={y0 + r * size}
              width={size}
              height={size}
              fill={art(LETTER[ch])}
            />
          )
        )
      )}
    </svg>
  );
}

function Empty() {
  const step = 11;
  const cx = 80;
  const cy = 60;
  const sizes = [0, 5.5, 4.6, 3.6, 2.7, 1.9, 1.3];
  const dots: ReactNode[] = [];
  for (let j = -4; j <= 4; j++)
    for (let i = -6; i <= 6; i++) {
      const d = Math.max(Math.abs(i), Math.abs(j));
      if (d === 0) continue;
      const s = sizes[Math.min(d, 6)];
      dots.push(
        <rect
          key={`${i},${j}`}
          className="a-breathe"
          style={delay(d * 90)}
          x={cx + i * step - s / 2}
          y={cy + j * step - s / 2}
          width={s}
          height={s}
          fill={art('magenta')}
        />
      );
    }
  return (
    <svg viewBox="0 0 160 120" preserveAspectRatio="xMidYMid meet">
      {[-1, 1].flatMap((sx) =>
        [-1, 1].map((sy) => (
          <line
            key={`${sx}${sy}`}
            x1={cx + sx * 6}
            y1={cy + sy * 6}
            x2={cx + sx * 3 * step}
            y2={cy + sy * 3 * step}
            stroke={art('magenta')}
            strokeWidth={0.6}
            strokeOpacity={0.6}
          />
        ))
      )}
      {dots}
      <rect
        x={cx - 6}
        y={cy - 6}
        width={12}
        height={12}
        fill={art('magenta')}
        fillOpacity={0.3}
        stroke={art('magenta')}
        strokeWidth={0.75}
      />
      <rect className="a-blink" x={cx - 3} y={cy - 3} width={6} height={6} fill={art('magenta')} />
    </svg>
  );
}

function Container() {
  const cx = 80;
  const cy = 60;
  const corners = [
    [-56, -44],
    [56, -44],
    [56, 44],
    [-56, 44],
  ];
  const ring: { x: number; y: number; diamond: boolean }[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    const r = k % 2 ? 24 : 21;
    ring.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, diamond: k % 2 === 1 });
  }
  return (
    <svg viewBox="14 8 132 104" preserveAspectRatio="xMidYMid meet">
      {corners.map(([dx, dy], i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={cx + dx}
          y2={cy + dy}
          stroke={art('lime')}
          strokeOpacity={0.5}
          strokeWidth={0.6}
        />
      ))}
      <line
        x1={cx}
        y1={cy - 40}
        x2={cx}
        y2={cy + 40}
        stroke={art('lime')}
        strokeOpacity={0.35}
        strokeWidth={0.6}
      />
      <line
        x1={cx - 40}
        y1={cy}
        x2={cx + 40}
        y2={cy}
        stroke={art('lime')}
        strokeOpacity={0.35}
        strokeWidth={0.6}
      />
      {[
        [0, -40],
        [40, 0],
        [0, 40],
        [-40, 0],
      ].map(([dx, dy], i) => (
        <rect
          key={i}
          x={cx + dx - 3.5}
          y={cy + dy - 3.5}
          width={7}
          height={7}
          fill={art('yellow')}
          fillOpacity={0.4}
        />
      ))}
      <g className="a-turn" style={delay(300)}>
        {ring.map((p, i) => (
          <rect
            key={i}
            x={p.x - 5}
            y={p.y - 5}
            width={10}
            height={10}
            fill={art('lime')}
            fillOpacity={0.35}
            stroke={art('lime')}
            strokeWidth={0.75}
            transform={p.diamond ? `rotate(45 ${p.x} ${p.y})` : undefined}
          />
        ))}
      </g>
      <rect
        x={cx - 11}
        y={cy - 11}
        width={22}
        height={22}
        fill={art('yellow')}
        fillOpacity={0.22}
        stroke={art('yellow')}
        strokeWidth={0.75}
      />
      <rect className="a-blink" x={cx - 6} y={cy - 6} width={12} height={12} fill={art('lime')} />
      {corners.map(([dx, dy], i) => (
        <rect
          key={i}
          className="a-pop"
          style={delay(900 + i * 120)}
          x={cx + dx - 4}
          y={cy + dy - 4}
          width={8}
          height={8}
          fill={art('yellow')}
        />
      ))}
    </svg>
  );
}

function Worker() {
  // Eight tangential pills around a ring: the reel's loader.
  const pills: Art[] = ['blue', 'orange', 'lime', 'yellow', 'orange', 'magenta', 'pink', 'pink'];
  return (
    <svg viewBox="0 0 300 110" preserveAspectRatio="xMidYMid meet">
      <g transform="translate(60 55)">
        <g className="a-spin">
          <rect x={-7} y={-25} width={14} height={50} rx={7} fill={art('orange')} />
          <rect x={-25} y={-7} width={50} height={14} rx={7} fill={art('yellow')} />
          <rect x={-7} y={-7} width={14} height={14} fill={art('light')} />
          {[
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(([sx, sy], i) => (
            <rect
              key={i}
              x={sx * 17 - 4.5}
              y={sy * 17 - 4.5}
              width={9}
              height={9}
              rx={2.5}
              fill={art('pink')}
            />
          ))}
        </g>
      </g>
      <g transform="translate(150 55)">
        <g className="a-spin" style={delay(400)}>
          <rect x={-4.5} y={-4.5} width={9} height={9} rx={2.5} fill={art('yellow')} />
          {[
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(([sx, sy], i) => (
            <g key={i}>
              <rect
                x={sx * 10 - 4}
                y={sy * 10 - 4}
                width={8}
                height={8}
                rx={2.5}
                fill={art('pink')}
              />
              <rect
                x={sx * 20 - 4}
                y={sy * 20 - 4}
                width={8}
                height={8}
                rx={2.5}
                fill={art('magenta')}
              />
            </g>
          ))}
          <rect x={-4} y={-30} width={8} height={8} rx={2.5} fill={art('yellow')} />
          <rect x={-4} y={22} width={8} height={8} rx={2.5} fill={art('yellow')} />
          <rect x={-30} y={-4} width={8} height={8} rx={2.5} fill={art('pink')} />
          <rect x={22} y={-4} width={8} height={8} rx={2.5} fill={art('pink')} />
        </g>
      </g>
      <g transform="translate(240 55)">
        <g className="a-ring">
          {pills.map((color, k) => (
            <rect
              key={k}
              x={-9}
              y={-26}
              width={18}
              height={10}
              rx={5}
              fill={art(color)}
              transform={`rotate(${k * 45})`}
            />
          ))}
        </g>
      </g>
    </svg>
  );
}

// The reel's scan: pixels in frame coordinates (0–100), [colour, x, y, size].
const PIXELS: [Art, number, number, number][] = [
  ['lime', 20, 18, 6],
  ['magenta', 27, 25, 6],
  ['orange', 40, 14, 11],
  ['yellow', 30, 31, 11],
  ['cyan', 53, 31, 11],
  ['cyan', 79, 35, 6],
  ['magenta', 19, 47, 11],
  ['yellow', 64, 47, 11],
  ['orange', 12, 60, 6],
  ['magenta', 53, 59, 11],
  ['lime', 40, 72, 11],
  ['cyan', 66, 68, 6],
  ['orange', 73, 75, 6],
];

function Import() {
  const clip = `nab-scan-${useId().replace(/[^\w-]/g, '')}`;
  const fx = 110;
  const fy = 5;
  const line = 82;
  const pixels = (paint?: Art) =>
    PIXELS.map(([color, x, y, s], i) => (
      <rect key={i} x={fx + x} y={fy + y} width={s} height={s} fill={art(paint ?? color)} />
    ));
  const services: [Art, number][] = [
    ['cyan', 22],
    ['magenta', 55],
    ['yellow', 88],
  ];
  return (
    <svg viewBox="26 0 262 110" preserveAspectRatio="xMidYMid meet">
      <defs>
        {/* Everything left of the scan line is lit; it moves with the line. */}
        <clipPath id={clip}>
          <rect className="a-scan" x={fx - 100} y={fy} width={100 + line} height={100} />
        </clipPath>
      </defs>
      {/* The repository goes in on the left… */}
      <line
        className="a-march"
        x1={52}
        y1={55}
        x2={fx}
        y2={55}
        stroke={art('light')}
        strokeOpacity={0.45}
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <rect x={36} y={48} width={14} height={14} fill={art('orange')} />
      {/* …the services come out on the right. */}
      {services.map(([color, y], i) => (
        <g key={color}>
          <line
            className="a-march"
            x1={fx + 100}
            y1={55}
            x2={262}
            y2={y}
            stroke={art('light')}
            strokeOpacity={0.45}
            strokeWidth={1}
            strokeDasharray="2 3"
          />
          <rect
            className="a-pop"
            style={delay(i * 110)}
            x={262}
            y={y - 6}
            width={12}
            height={12}
            fill={art(color)}
          />
        </g>
      ))}
      <g>
        {Array.from({ length: 7 }, (_, k) => (
          <g key={k}>
            <line
              x1={fx + (k + 1) * 12.5}
              y1={fy}
              x2={fx + (k + 1) * 12.5}
              y2={fy + 100}
              stroke={art('mute')}
              strokeOpacity={0.35}
              strokeWidth={0.5}
            />
            <line
              x1={fx}
              y1={fy + (k + 1) * 12.5}
              x2={fx + 100}
              y2={fy + (k + 1) * 12.5}
              stroke={art('mute')}
              strokeOpacity={0.35}
              strokeWidth={0.5}
            />
          </g>
        ))}
      </g>
      {pixels('mute')}
      <g clipPath={`url(#${clip})`}>{pixels()}</g>
      <g className="a-scan">
        <rect
          x={fx + line}
          y={fy}
          width={100 - line}
          height={100}
          fill={art('mute')}
          fillOpacity={0.25}
        />
        <rect x={fx + line - 0.75} y={fy} width={1.5} height={100} fill={art('light')} />
      </g>
      <rect
        x={fx + 0.5}
        y={fy + 0.5}
        width={99}
        height={99}
        fill="none"
        stroke={art('mute')}
        strokeWidth={1}
      />
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

// Four-by-four pixel glyphs for Fold's strip, after the reel's small icons.
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
