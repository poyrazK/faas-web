import type { FlowNode, ConnectSide } from './nodes';
import type { WindFlowEdge } from './wind-edge';
import type { Point } from './layout';
import type { Topology } from './topology';
import type { LaunchState } from './launch';
import { neighbourhood } from './focus';

export type FlowOptions = {
  onConnect?: (slug: string, side: ConnectSide) => void;
  onRetry?: (slug: string) => void;
  /** The selected node: its one-hop neighbourhood stays lit, the rest dims. */
  selected?: string;
  /** First deploys the canvas is watching, by slug. */
  launches?: Record<string, LaunchState>;
  onLaunchAction?: (slug: string, action: 'retry' | 'logs') => void;
};

export function toFlow(
  t: Topology,
  pos: Map<string, Point>,
  opts: FlowOptions = {}
): { nodes: FlowNode[]; edges: WindFlowEdge[] } {
  const near = opts.selected ? neighbourhood(t, opts.selected) : undefined;
  const launch = (slug: string) => opts.launches?.[slug];
  // Traffic into an app that is not live yet has nowhere to go: dashed.
  const unreachable = new Set(
    t.nodes.flatMap((n) => {
      const l = n.data.kind === 'app' ? launch(n.data.slug) : undefined;
      return l && l.stage !== 'live' ? [n.id] : [];
    })
  );
  const nodes: FlowNode[] = t.nodes.map((n) => {
    const data = n.data;
    const dim = near ? !near.nodes.has(n.id) : false;
    return {
      id: n.id,
      type: data.kind,
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data:
        data.kind === 'app'
          ? {
              ...data,
              dim,
              ...(opts.onConnect && {
                onConnect: (side: ConnectSide) => opts.onConnect!(data.slug, side),
              }),
              ...(opts.onRetry && { onRetry: () => opts.onRetry!(data.slug) }),
              launch: launch(data.slug),
              ...(opts.onLaunchAction && {
                onLaunchAction: (a: 'retry' | 'logs') => opts.onLaunchAction!(data.slug, a),
              }),
            }
          : { ...data, dim },
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
    data: {
      requests24h: e.requests24h,
      pending: e.pending || (e.kind === 'ingress' && unreachable.has(e.target)),
      highlight: near ? near.edges.has(e.id) : false,
      dim: near ? !near.edges.has(e.id) : false,
    },
    selectable: false,
  }));
  return { nodes, edges };
}
