import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { useReducedMotion } from 'motion/react';
import { edgeLabel, particles } from './traffic';

export type WindEdgeData = {
  requests24h?: number;
  pending?: boolean;
  draft?: boolean;
  /** In the selected node's neighbourhood. */
  highlight?: boolean;
  /** Outside it. */
  dim?: boolean;
  /** Leads to a next-step suggestion, not to anything real. */
  ghost?: boolean;
};
export type WindFlowEdge = Edge<WindEdgeData, 'wind'>;

/**
 * Requests travel as mint particles, as many as the real count earns.
 * Reduced motion swaps them for a static mint stroke whose width carries the
 * same reading. Hovering an edge names its count; an unknown count stays
 * unnamed.
 */
export function WindEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<WindFlowEdge>) {
  const reduce = useReducedMotion();
  const [hover, setHover] = useState(false);
  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const traffic = particles(data?.requests24h);

  if (data?.ghost) {
    return (
      <BaseEdge
        id={id}
        path={path}
        style={{ stroke: 'var(--brand)', strokeOpacity: 0.4, strokeDasharray: '3 5' }}
      />
    );
  }
  if (data?.draft) {
    return (
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: 'var(--brand)',
          strokeOpacity: 0.55,
          strokeDasharray: '3 4',
          animation: reduce ? undefined : 'canvas-march 1s linear infinite',
        }}
      />
    );
  }
  if (data?.pending) {
    return (
      <BaseEdge
        id={id}
        path={path}
        style={{
          stroke: 'var(--status-warning)',
          strokeOpacity: 0.5,
          strokeDasharray: '2 4',
          opacity: data.dim ? 0.25 : 1,
        }}
      />
    );
  }

  const label = edgeLabel(data?.requests24h);
  const stroke = data?.highlight
    ? { stroke: 'var(--brand)', strokeOpacity: 0.55, strokeWidth: 1.5 }
    : reduce && traffic.count > 0
      ? { stroke: 'var(--brand)', strokeOpacity: 0.7, strokeWidth: traffic.strokeWidth }
      : { stroke: 'var(--canvas-edge)', strokeWidth: 1 };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          ...stroke,
          opacity: data?.dim ? 0.25 : 1,
          transition: 'opacity var(--motion-base) var(--motion-ease)',
        }}
      />
      {/* A wide invisible hit area: a 1px line is too thin to hover. React
          Flow marks non-selectable edges inactive (pointer-events: none), so the
          hit area opts back in explicitly. */}
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={16}
        style={{ pointerEvents: 'stroke' }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      />
      {!reduce &&
        !data?.dim &&
        Array.from({ length: traffic.count }, (_, i) => (
          <circle
            key={i}
            r={traffic.count > 2 ? 1.8 : 1.4}
            style={{ fill: 'var(--brand)' }}
            opacity={0.9}
          >
            <animateMotion
              dur={`${traffic.durationS}s`}
              // Negative: each particle starts mid-path. A positive delay
              // parks it at the origin, a stray dot, until its turn.
              begin={`-${((i * traffic.durationS) / traffic.count).toFixed(2)}s`}
              repeatCount="indefinite"
              path={path}
            />
          </circle>
        ))}
      {hover && label && (
        <EdgeLabelRenderer>
          <span
            className="pointer-events-none absolute rounded-md border border-border bg-popover px-1.5 py-0.5 font-mono text-[10px] tracking-[0.04em] text-foreground shadow-elevation-2"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes = { wind: WindEdge };
