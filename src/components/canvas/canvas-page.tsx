import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState, UnreachableState } from '@/components/dashboard/primitives';
import { ReactFlowProvider } from '@xyflow/react';
import { CanvasView } from './canvas';
import { useCamera } from './camera';
import { toFlow } from './flow';
import { Inspector } from './inspector';
import { menuPosition, layout } from './layout';
import { useTopology } from './use-topology';
import { LaneHeaders } from './lane-headers';
import { ConnectMenu } from './connect-menu';
import type { CreateKind } from './create';
import type { ConnectSide } from './nodes';
import { summarizeIssues, type AppData } from './topology';
import { useApps } from '@/lib/api/queries';

/** Canvas page. `data-gregale-canvas` is the build-elimination sentinel (plan Task 1). */
export default function CanvasPage({ node }: { node?: string }) {
  return (
    <ReactFlowProvider>
      <CanvasPageBody node={node} />
    </ReactFlowProvider>
  );
}

function CanvasPageBody({ node }: { node?: string }) {
  const navigate = useNavigate();
  const camera = useCamera();
  const { phase, error, topology, retry, retryApp, settled } = useTopology();
  const select = useCallback(
    (id?: string) =>
      void navigate({ to: '/dashboard/canvas', search: id ? { node: id } : {}, replace: true }),
    [navigate]
  );

  const [connect, setConnect] = useState<{
    slug: string;
    side: ConnectSide;
    kind?: CreateKind;
  }>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (connect) setConnect(undefined);
      else if (node) select(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connect, node, select]);

  const slotKind = connect?.kind;
  const slotSide = connect?.side;
  const slotApp = slotKind && connect ? `app:${connect.slug}` : undefined;
  const slot = useMemo(
    () =>
      slotApp && slotKind && slotSide
        ? { app: slotApp, side: slotSide, kind: slotKind }
        : undefined,
    [slotApp, slotSide, slotKind]
  );
  const positions = useMemo(() => layout(topology, { draft: slot }), [topology, slot]);

  // Once the bands have eased (240ms), make sure the whole draft is on screen.
  useEffect(() => {
    if (!slotApp) return;
    const id = window.setTimeout(() => camera.ensureVisible(['draft', slotApp]), 260);
    return () => window.clearTimeout(id);
  }, [slotApp, camera]);
  const flow = useMemo(
    () =>
      toFlow(topology, positions, {
        onConnect: (slug, side) => setConnect({ slug, side }),
        onRetry: retryApp,
        selected: node,
      }),
    [topology, positions, retryApp, node]
  );
  const connectApp = connect && topology.nodes.find((n) => n.id === `app:${connect.slug}`);
  const appData = connectApp?.data.kind === 'app' ? (connectApp.data as AppData) : undefined;
  // Already cached by useTopology; this is a read of the same query, not a request.
  const appId = useApps().data?.find((a) => a.slug === connect?.slug)?.id;
  const anchor = connect && positions.get(`app:${connect.slug}`);

  const draftId = 'draft';
  const withDraft = useMemo(
    () =>
      connect?.kind && appData && anchor && appId
        ? {
            nodes: [
              ...flow.nodes,
              {
                id: draftId,
                type: 'draft',
                position: positions.get(draftId) ?? menuPosition(anchor, connect.side),
                data: {
                  kind: connect.kind,
                  app: {
                    slug: appData.slug,
                    id: appId,
                    defaultRegion: appData.buckets?.defaultRegion,
                  },
                  onDone: () => setConnect(undefined),
                  onCancel: () => setConnect(undefined),
                },
                draggable: false,
                selectable: false,
                // The one place the draft's data meets the topology-typed union.
              } as unknown as (typeof flow.nodes)[number],
            ],
            edges: [
              ...flow.edges,
              connect.side === 'in'
                ? {
                    id: 'draft-edge',
                    source: draftId,
                    sourceHandle: 'out',
                    target: `app:${connect.slug}`,
                    targetHandle: 'in',
                    type: 'wind' as const,
                    data: { draft: true },
                  }
                : {
                    id: 'draft-edge',
                    source: `app:${connect.slug}`,
                    sourceHandle: 'out',
                    target: draftId,
                    targetHandle: 'in',
                    type: 'wind' as const,
                    data: { draft: true },
                  },
            ],
          }
        : flow,
    [connect, appData, anchor, appId, flow, positions]
  );
  const selected = topology.nodes.find((n) => n.id === node);
  const gaps = useMemo(() => summarizeIssues(topology.issues), [topology.issues]);

  return (
    <div data-gregale-canvas="" className="relative h-full">
      <p className="m-6 text-sm text-muted-foreground md:hidden">
        The canvas needs a wider screen. Every resource is still on its own page.
      </p>
      <div className="hidden h-full md:flex">
        {phase === 'loading' && <LoadingState message="Loading canvas…" className="m-6 flex-1" />}
        {phase === 'unreachable' && <UnreachableState onRetry={retry} className="m-6 flex-1" />}
        {phase === 'error' && <ErrorState error={error} onRetry={retry} className="m-6 flex-1" />}
        {phase === 'empty' && (
          <div className="canvas-surface relative grid flex-1 place-items-center">
            <div className="relative w-80 rounded-[var(--console-surface-radius)] border border-canvas-glass-border bg-canvas-glass p-5 shadow-elevation-3 backdrop-blur-md">
              <p className="label-mono text-[11px] text-muted-foreground">Canvas</p>
              <p className="mt-1 text-sm font-semibold">Nothing to draw yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Domains, crons and buckets all hang off an app. Deploy one and it appears here.
              </p>
              <Button asChild className="mt-4 w-full">
                <Link to="/dashboard/workflows/new">Deploy an app</Link>
              </Button>
            </div>
          </div>
        )}
        {phase === 'ready' && (
          <>
            <div className="relative flex-1">
              {gaps.length > 0 && (
                <div
                  role="status"
                  className="absolute top-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-status-warning/30 bg-canvas-glass py-1.5 pr-1.5 pl-3 text-[12px] shadow-elevation-2 backdrop-blur-md"
                >
                  <span aria-hidden className="size-1.5 rounded-full bg-status-warning" />
                  <span>{gaps.join(' ')}</span>
                  <Button size="xs" variant="outline" onClick={retry}>
                    Retry
                  </Button>
                </div>
              )}
              <CanvasView
                nodes={withDraft.nodes}
                edges={withDraft.edges}
                selected={node}
                onSelect={select}
                settled={settled}
                onPick={(id) => {
                  select(id);
                  camera.flyTo(id);
                }}
              >
                <LaneHeaders top={-44} />
                {connect && appData && anchor && !connect.kind && (
                  <ConnectMenu
                    app={appData}
                    side={connect.side}
                    at={menuPosition(anchor, connect.side)}
                    onPick={(kind) => setConnect({ ...connect, kind })}
                    onClose={() => setConnect(undefined)}
                    onRetry={() => retryApp(connect.slug)}
                  />
                )}
              </CanvasView>
            </div>
            {selected && (
              <Inspector
                key={selected.id}
                node={selected}
                topology={topology}
                onClose={() => select(undefined)}
                onFly={(id) => {
                  select(id);
                  camera.flyTo(id);
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
