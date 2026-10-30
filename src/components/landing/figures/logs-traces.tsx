import { type MotionValue, motion, useTransform } from 'motion/react';
import { SPANS, spanCrossed, traceCursor } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** A cursor reads one request: the spans it crosses fill, and log ticks appear. */
export function LogsTracesFigure() {
  return (
    <FigureFrame name="logs-traces">
      <LogsTraces />
    </FigureFrame>
  );
}

function LogsTraces() {
  const { px, active } = useFigure();
  const cursor = useTransform(px, traceCursor);
  return (
    <>
      {SPANS.map((_, i) => (
        <Span key={i} i={i} cursor={cursor} />
      ))}
      <motion.line
        data-part="cursor"
        x1={cursor}
        y1={16}
        x2={cursor}
        y2={184}
        strokeOpacity={active}
      />
    </>
  );
}

function Span({ i, cursor }: { i: number; cursor: MotionValue<number> }) {
  const { active } = useFigure();
  const [x, y, w] = SPANS[i];
  const lit = useTransform([cursor, active], ([c, a]: number[]) => a * (spanCrossed(i, c) ? 1 : 0));
  const fillOpacity = useTransform(lit, (v) => 0.12 + 0.88 * v);
  const tickEnd = useTransform(lit, (v) => 352 + 40 * v);
  const tickY = 31 + 22 * i;
  return (
    <>
      <motion.rect
        data-part="span"
        x={x}
        y={y}
        width={w}
        height={14}
        rx={3}
        fill="var(--brand)"
        fillOpacity={fillOpacity}
      />
      <motion.line
        data-part="tick"
        x1={352}
        y1={tickY}
        x2={tickEnd}
        y2={tickY}
        strokeWidth={2}
        strokeOpacity={lit}
      />
    </>
  );
}
