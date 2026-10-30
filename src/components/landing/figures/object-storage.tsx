import { type MotionValue, motion, useTransform } from 'motion/react';
import { OBJECTS, objectPos, storeFill } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** Objects leave the app for a bucket whose lid never opens. */
export function ObjectStorageFigure() {
  return (
    <FigureFrame name="object-storage">
      <ObjectStorage />
    </FigureFrame>
  );
}

function ObjectStorage() {
  const { px, active } = useFigure();
  const fill = useTransform([px, active], ([x, a]: number[]) => storeFill(x, a));
  return (
    <>
      <rect x={24} y={56} width={96} height={88} rx={8} />
      <path d="M 280 40 V 168 Q 280 176 288 176 H 384 Q 392 176 392 168 V 40" />
      <rect
        data-part="lid"
        x={272}
        y={32}
        width={128}
        height={6}
        rx={2}
        fill="var(--brand)"
        stroke="none"
      />
      {Array.from({ length: OBJECTS }, (_, i) => (
        <StoredObject key={i} i={i} fill={fill} />
      ))}
    </>
  );
}

function StoredObject({ i, fill }: { i: number; fill: MotionValue<number> }) {
  const x = useTransform(fill, (f) => objectPos(i, f)[0]);
  const y = useTransform(fill, (f) => objectPos(i, f)[1]);
  return (
    <motion.rect
      data-part="object"
      x={x}
      y={y}
      width={10}
      height={10}
      rx={2}
      fill="var(--brand)"
      stroke="none"
    />
  );
}
