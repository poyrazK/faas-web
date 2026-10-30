import { type MotionValue, motion, useTransform } from 'motion/react';
import { ROWS, dotX, rowCentre, rowSeal } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** Values stay sealed: the hovered row's dots gather into one solid block. */
export function SecretsConfigFigure() {
  return (
    <FigureFrame name="secrets-config">
      {Array.from({ length: ROWS }, (_, r) => (
        <Row key={r} r={r} />
      ))}
    </FigureFrame>
  );
}

function Row({ r }: { r: number }) {
  const { py, active } = useFigure();
  const yc = rowCentre(r);
  const seal = useTransform([py, active], ([y, a]: number[]) => rowSeal(r, y, a));
  return (
    <>
      <rect
        x={40}
        y={yc - 4}
        width={60}
        height={8}
        rx={2}
        fill="var(--brand)"
        fillOpacity={0.6}
        stroke="none"
      />
      {Array.from({ length: 8 }, (_, d) => (
        <Dot key={d} d={d} yc={yc} seal={seal} />
      ))}
      <motion.rect
        data-part="seal"
        x={191}
        y={yc - 7}
        width={64}
        height={14}
        rx={4}
        fill="var(--brand)"
        stroke="none"
        fillOpacity={seal}
      />
    </>
  );
}

function Dot({ d, yc, seal }: { d: number; yc: number; seal: MotionValue<number> }) {
  const cx = useTransform(seal, (m) => dotX(d, m));
  const fillOpacity = useTransform(seal, (m) => 1 - 0.9 * m);
  return (
    <motion.circle
      data-part="dot"
      cx={cx}
      cy={yc}
      r={4}
      fill="var(--brand)"
      stroke="none"
      fillOpacity={fillOpacity}
    />
  );
}
