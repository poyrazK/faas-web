import type { FlowNode, ConnectSide } from './nodes';
import type { WindFlowEdge } from './wind-edge';
import type { Point } from './layout';
import type { Topology } from './topology';

export type FlowOptions = {
  onConnect?: (slug: string, side: ConnectSide) => void;
  onRetry?: (slug: string) => void;
};

export function toFlow(
  t: Topology,
  pos: Map<string, Point>,
  opts: FlowOptions = {}
): { nodes: FlowNode[]; edges: WindFlowEdge[] } {
  const nodes: FlowNode[] = t.nodes.map((n) => {
    const data = n.data;
    return {
      id: n.id,
      type: data.kind,
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data:
        data.kind === 'app'
          ? {
              ...data,
              ...(opts.onConnect && {
                onConnect: (side: ConnectSide) => opts.onConnect!(data.slug, side),
              }),
              ...(opts.onRetry && { onRetry: () => opts.onRetry!(data.slug) }),
            }
          : data,
      connectable: false,
    };
  });
  const edges: WindFlowEdge[] = t.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'wind',
    sourceHandle: 'out',
    targetHandle: e.kind === 'schedule' ? 'top' : 'in',
    data: { requests24h: e.requests24h, pending: e.pending },
    selectable: false,
  }));
  return { nodes, edges };
}
