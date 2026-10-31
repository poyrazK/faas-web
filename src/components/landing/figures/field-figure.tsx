import { motion, useTransform, type MotionValue } from 'motion/react';
import { FigureFrame, useFigure } from './figure-frame';
import type { Field, Layer } from './geometry';

type Paths = Record<string, string>;

/**
 * Draws a Hosting figure's texture: each row is a few batched paths, one per
 * layer, derived from the frame's motion values, so the pointer never renders
 * React. A few hundred marks cost at most 60 DOM nodes.
 */
export function FieldFigure({ field }: { field: Field }) {
  return (
    <FigureFrame name={field.name}>
      {Array.from({ length: field.rows }, (_, r) => (
        <FieldRow key={r} r={r} field={field} />
      ))}
    </FigureFrame>
  );
}

function FieldRow({ r, field }: { r: number; field: Field }) {
  const { px, py, active } = useFigure();
  const paths = useTransform([px, py, active], ([x, y, a]: number[]) => field.row(r, x, y, a));
  return (
    <g>
      {field.layers.map((layer) => (
        <LayerPath key={layer.key} paths={paths} layer={layer} />
      ))}
    </g>
  );
}

function LayerPath({ paths, layer }: { paths: MotionValue<Paths>; layer: Layer }) {
  const d = useTransform(paths, (p) => p[layer.key] ?? '');
  return (
    <motion.path
      d={d}
      fill={layer.fill ?? 'none'}
      stroke={layer.stroke ?? 'none'}
      opacity={layer.opacity}
    />
  );
}
