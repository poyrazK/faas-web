import { motion, useTransform } from 'motion/react';
import { COMMITS, branchCommit, branchHeight, branchNodeX, branchPath } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** A branch forks from the nearest commit to a preview, and merges back. */
export function PrPreviewsFigure() {
  return (
    <FigureFrame name="pr-previews">
      <PrPreviews />
    </FigureFrame>
  );
}

function PrPreviews() {
  const { px, active } = useFigure();
  const cx = useTransform(px, branchCommit);
  const d = useTransform([cx, active], ([c, a]: number[]) => branchPath(c, a));
  const nodeX = useTransform(cx, (c) => branchNodeX(c) - 22);
  const nodeY = useTransform(active, (a) => 140 - branchHeight(a) - 30);
  const dotX = useTransform(cx, branchNodeX);
  const dotY = useTransform(active, (a) => 140 - branchHeight(a) - 15);
  return (
    <>
      <line x1={24} y1={140} x2={396} y2={140} />
      {COMMITS.map((x) => (
        <circle
          key={x}
          data-part="commit"
          cx={x}
          cy={140}
          r={4}
          fill="var(--brand)"
          stroke="none"
        />
      ))}
      <motion.path data-part="branch" d={d} />
      <motion.rect
        data-part="node"
        x={nodeX}
        y={nodeY}
        width={44}
        height={30}
        rx={5}
        fill="var(--background)"
        fillOpacity={active}
        strokeOpacity={active}
      />
      <motion.circle
        cx={dotX}
        cy={dotY}
        r={3}
        fill="var(--brand)"
        stroke="none"
        fillOpacity={active}
      />
    </>
  );
}
