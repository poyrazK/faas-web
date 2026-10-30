import { type MotionValue, motion, useTransform } from 'motion/react';
import {
  DEPLOY_REST,
  deployBar,
  deployDotRadius,
  deployFrame,
  deployProgress,
  perimeterPath,
} from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** Loose pieces become one image, then a snapshot, then live. */
export function SourceDeploysFigure() {
  return (
    <FigureFrame name="source-deploys">
      <SourceDeploys />
    </FigureFrame>
  );
}

function SourceDeploys() {
  const { px, active } = useFigure();
  const p = useTransform([px, active], ([x, a]: number[]) => deployProgress(x, a));
  const frame = useTransform(p, (v) => perimeterPath(218, 34, 88, 128, deployFrame(v)));
  const dot = useTransform(p, deployDotRadius);
  return (
    <>
      {DEPLOY_REST.map((_, i) => (
        <Bar key={i} i={i} p={p} />
      ))}
      <motion.path data-part="frame" d={frame} />
      <motion.circle data-part="dot" cx={336} cy={98} r={dot} fill="var(--brand)" stroke="none" />
    </>
  );
}

function Bar({ i, p }: { i: number; p: MotionValue<number> }) {
  const x = useTransform(p, (v) => deployBar(i, v).x);
  const y = useTransform(p, (v) => deployBar(i, v).y);
  const fillOpacity = useTransform(p, (v) => deployBar(i, v).fillOpacity);
  return (
    <motion.rect
      data-part="bar"
      x={x}
      y={y}
      width={64}
      height={5}
      rx={2}
      fill="var(--brand)"
      fillOpacity={fillOpacity}
    />
  );
}
