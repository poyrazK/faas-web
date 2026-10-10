import type { FlowNode, ConnectSide } from './nodes';
import type { WindFlowEdge } from './wind-edge';
import type { Point } from './layout';
import type { Topology } from './topology';

export function toFlow(
  t: Topology,
  pos: Map<string, Point>,
  onConnect?: (slug: string, side: ConnectSide) => void
): { nodes: FlowNode[]; edges: WindFlowEdge[] } {
  const nodes: FlowNode[] = t.nodes.map((n) => ({
    id: n.id,
    type: n.data.kind,
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    data:
      n.data.kind === 'app' && onConnect
        ? {
            ...n.data,
            onConnect: (side: ConnectSide) => onConnect((n.data as { slug: string }).slug, side),
          }
        : n.data,
    connectable: false,
  }));
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
