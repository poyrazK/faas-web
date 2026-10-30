import { type MotionValue, motion, useTransform } from 'motion/react';
import { CELLS, cellAt, cellCore } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** One cell reacts; its neighbours stay perfectly still. */
export function IsolatedComputeFigure() {
  return (
    <FigureFrame name="isolated-compute">
      <IsolatedCompute />
    </FigureFrame>
  );
}

function IsolatedCompute() {
  const { px, py } = useFigure();
  const hovered = useTransform([px, py], ([x, y]: number[]) => cellAt(x, y));
  return (
    <>
      {CELLS.map((_, i) => (
        <Cell key={i} index={i} hovered={hovered} />
      ))}
    </>
  );
}

function Cell({ index, hovered }: { index: number; hovered: MotionValue<number> }) {
  const { active } = useFigure();
  const { x, y } = CELLS[index];
  const state = useTransform([hovered, active], ([h, a]: number[]) => cellCore(index, h, a));
  const strokeWidth = useTransform(state, (s) => s.stroke);
  const size = useTransform(state, (s) => s.size);
  const coreX = useTransform(size, (s) => x + (56 - s) / 2);
  const coreY = useTransform(size, (s) => y + (48 - s) / 2);
  return (
    <>
      <motion.rect
        data-part="cell"
        x={x}
        y={y}
        width={56}
        height={48}
        rx={8}
        strokeWidth={strokeWidth}
      />
      <motion.rect
        data-part="core"
        x={coreX}
        y={coreY}
        width={size}
        height={size}
        rx={2}
        fill="var(--brand)"
        stroke="none"
      />
    </>
  );
}
