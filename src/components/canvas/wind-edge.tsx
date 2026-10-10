import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react';
import { useReducedMotion } from 'motion/react';
import { particles } from './traffic';

export type WindEdgeData = { requests24h?: number; pending?: boolean; draft?: boolean };
export type WindFlowEdge = Edge<WindEdgeData, 'wind'>;

/**
 * Requests travel as mint particles, as many as the real count earns.
 * Reduced motion swaps them for a static mint stroke whose width carries the
 * same reading.
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
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const traffic = particles(data?.requests24h);

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
        style={{ stroke: 'var(--status-warning)', strokeOpacity: 0.5, strokeDasharray: '2 4' }}
      />
    );
  }
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={
          reduce && traffic.count > 0
            ? { stroke: 'var(--brand)', strokeOpacity: 0.7, strokeWidth: traffic.strokeWidth }
            : { stroke: 'var(--canvas-edge)', strokeWidth: 1 }
        }
      />
      {!reduce &&
        Array.from({ length: traffic.count }, (_, i) => (
          <circle
            key={i}
            r={traffic.count > 2 ? 1.8 : 1.4}
            style={{ fill: 'var(--brand)' }}
            opacity={0.9}
          >
            <animateMotion
              dur={`${traffic.durationS}s`}
              begin={`${((i * traffic.durationS) / traffic.count).toFixed(2)}s`}
              repeatCount="indefinite"
              path={path}
            />
          </circle>
        ))}
    </>
  );
}

export const edgeTypes = { wind: WindEdge };
