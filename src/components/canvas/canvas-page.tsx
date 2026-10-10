import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState, UnreachableState } from '@/components/dashboard/primitives';
import { CanvasView } from './canvas';
import { toFlow } from './flow';
import { Inspector } from './inspector';
import { draftPosition, layout } from './layout';
import { useTopology } from './use-topology';
import { ConnectMenu } from './connect-menu';
import type { CreateKind } from './create';
import type { ConnectSide } from './nodes';
import type { AppData } from './topology';
import { useApps } from '@/lib/api/queries';

/** Canvas page. `data-gregale-canvas` is the build-elimination sentinel (plan Task 1). */
export default function CanvasPage({ node }: { node?: string }) {
  const navigate = useNavigate();
  const { phase, error, topology, retry } = useTopology();
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

  const positions = useMemo(() => layout(topology), [topology]);
  const flow = useMemo(
    () => toFlow(topology, positions, (slug, side) => setConnect({ slug, side })),
    [topology, positions]
  );
  const connectApp = connect && topology.nodes.find((n) => n.id === `app:${connect.slug}`);
  const appData = connectApp?.data.kind === 'app' ? (connectApp.data as AppData) : undefined;
  // Already cached by useTopology; this is a read of the same query, not a request.
  const appId = useApps().data?.find((a) => a.slug === connect?.slug)?.id;
  const anchor = connect && positions.get(`app:${connect.slug}`);

  const draftId = 'draft';
  const withDraft =
    connect?.kind && appData && anchor && appId
      ? {
          nodes: [
            ...flow.nodes,
            {
              id: draftId,
              type: 'draft',
              position: draftPosition(anchor, connect.side),
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
      : flow;
  const selected = topology.nodes.find((n) => n.id === node);

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
              <CanvasView
                nodes={withDraft.nodes}
                edges={withDraft.edges}
                selected={node}
                onSelect={select}
              >
                {connect && appData && anchor && !connect.kind && (
                  <ConnectMenu
                    app={appData}
                    side={connect.side}
                    at={draftPosition(anchor, connect.side)}
                    onPick={(kind) => setConnect({ ...connect, kind })}
                    onClose={() => setConnect(undefined)}
                  />
                )}
              </CanvasView>
            </div>
            {selected && (
              <Inspector node={selected} topology={topology} onClose={() => select(undefined)} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
