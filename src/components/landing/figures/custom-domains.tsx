import { motion, useTransform } from 'motion/react';
import { RINGS, domainFill, lerp, ringRadius, shackleLift } from './geometry';
import { FigureFrame, useFigure } from './figure-frame';

/** A path from the hostname to the app completes, and the lock closes. */
export function CustomDomainsFigure() {
  return (
    <FigureFrame name="custom-domains">
      <CustomDomains />
    </FigureFrame>
  );
}

function CustomDomains() {
  const { px, active } = useFigure();
  const fill = useTransform([px, active], ([x, a]: number[]) => domainFill(x, a));
  const fillEnd = useTransform(fill, (f) => lerp(84, 344, f));
  const lift = useTransform(fill, shackleLift);
  return (
    <>
      {[24, 38, 52, 66].map((x) => (
        <line key={x} x1={x} y1={100} x2={x + 8} y2={100} strokeWidth={2} />
      ))}
      <line x1={84} y1={100} x2={344} y2={100} strokeDasharray="2 6" strokeOpacity={0.5} />
      <motion.line data-part="fill" x1={84} y1={100} x2={fillEnd} y2={100} strokeWidth={1.5} />
      {RINGS.map((cx) => (
        <Ring key={cx} cx={cx} />
      ))}
      <rect x={344} y={82} width={52} height={36} rx={6} fill="var(--brand)" stroke="none" />
      <rect x={360} y={62} width={20} height={14} rx={2} fill="var(--brand)" stroke="none" />
      <motion.path
        data-part="shackle"
        d="M 364 62 V 56 A 6 6 0 0 1 376 56 V 62"
        strokeWidth={2}
        style={{ y: lift }}
      />
    </>
  );
}

function Ring({ cx }: { cx: number }) {
  const { px, active } = useFigure();
  const r = useTransform([px, active], ([x, a]: number[]) => ringRadius(cx, x, a));
  return <motion.circle data-part="ring" cx={cx} cy={100} r={r} fill="var(--background)" />;
}
