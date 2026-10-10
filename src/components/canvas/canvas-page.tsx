import { useCallback, useEffect, useMemo } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState, UnreachableState } from '@/components/dashboard/primitives';
import { CanvasView } from './canvas';
import { toFlow } from './flow';
import { Inspector } from './inspector';
import { layout } from './layout';
import { useTopology } from './use-topology';

/** Canvas page. `data-gregale-canvas` is the build-elimination sentinel (plan Task 1). */
export default function CanvasPage({ node }: { node?: string }) {
  const navigate = useNavigate();
  const { phase, error, topology, retry } = useTopology();
  const select = useCallback(
    (id?: string) =>
      void navigate({ to: '/dashboard/canvas', search: id ? { node: id } : {}, replace: true }),
    [navigate]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && node && select(undefined);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [node, select]);

  const flow = useMemo(() => toFlow(topology, layout(topology)), [topology]);
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
              <CanvasView nodes={flow.nodes} edges={flow.edges} selected={node} onSelect={select} />
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
