import type { FlowNode, ConnectSide } from './nodes';
import type { WindFlowEdge } from './wind-edge';
import { ghostPositions, NODE_SIZE, type Point } from './layout';
import type { CreateKind } from './create';
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
  /** Next-step suggestions around one app: the domain alone, or all three. */
  ghosts?: { slug: string; all: boolean };
  onGhost?: (slug: string, kind: CreateKind) => void;
  onDismissGhosts?: () => void;
};

const GHOST_LABEL: Record<CreateKind, string> = {
  domain: '+ Add a domain',
  cron: '+ Schedule a cron',
  bucket: '+ Add storage',
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
              // While its ghosts are out they are the app's way to add things;
              // the plus buttons would sit on their edges saying the same.
              ...(opts.onConnect &&
                !(opts.ghosts?.all && opts.ghosts.slug === data.slug) && {
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

  const at = opts.ghosts && pos.get(`app:${opts.ghosts.slug}`);
  if (opts.ghosts && at) {
    const { slug, all } = opts.ghosts;
    const appId = `app:${slug}`;
    const internet = pos.get('internet');
    const g = ghostPositions(at, internet && internet.y + NODE_SIZE.internet.h / 2);
    const kinds: CreateKind[] = all ? ['domain', 'cron', 'bucket'] : ['domain'];
    for (const kind of kinds) {
      nodes.push({
        id: `ghost:${kind}`,
        // Ghosts are not topology nodes; this is where they join the union.
        type: 'ghost' as never,
        position: g[kind],
        data: {
          kind,
          label: GHOST_LABEL[kind],
          next: kind === 'domain',
          onPick: () => opts.onGhost?.(slug, kind),
          onDismiss: kind === 'domain' ? opts.onDismissGhosts : undefined,
        } as never,
        draggable: false,
        selectable: false,
        connectable: false,
        // Its buttons take focus; the wrapper would be a second, empty tab stop.
        focusable: false,
      });
      edges.push({
        id: `ghost-edge:${kind}`,
        source: kind === 'bucket' ? appId : `ghost:${kind}`,
        target: kind === 'bucket' ? `ghost:${kind}` : appId,
        sourceHandle: kind === 'cron' ? 'down' : 'out',
        targetHandle: kind === 'cron' ? 'top' : 'in',
        type: 'wind',
        data: { ghost: true },
        selectable: false,
      });
    }
  }
  return { nodes, edges };
}
