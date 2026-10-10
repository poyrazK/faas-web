import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ErrorState, LoadingState, UnreachableState } from '@/components/dashboard/primitives';
import { ReactFlowProvider } from '@xyflow/react';
import { CanvasView } from './canvas';
import { useCamera } from './camera';
import { toFlow } from './flow';
import { Inspector, type InspectorTab } from './inspector';
import { LaunchTracker } from './launch-tracker';
import { Morph } from './morph';
import { useLaunches } from './use-launches';
import { useCreateAndDeploy } from '@/lib/api/create-and-deploy';
import { errorMessage } from '@/lib/api/errors';
import { APP_FAILED, APP_TALL, menuPosition, layout } from './layout';
import { useTopology } from './use-topology';
import { LaneHeaders } from './lane-headers';
import { ConnectMenu } from './connect-menu';
import type { CreateKind } from './create';
import type { ConnectSide } from './nodes';
import { summarizeIssues, type AppData } from './topology';
import { useApps } from '@/lib/api/queries';
import { Wizard, type LaunchSeed, type WizardStep } from './wizard/wizard';

function ghostsRetired(slug: string) {
  try {
    return localStorage.getItem(`gregale.canvas.ghosts.${slug}`) === 'done';
  } catch {
    return false;
  }
}

/** Canvas page. `data-gregale-canvas` is the build-elimination sentinel (plan Task 1). */
export default function CanvasPage({ node, wizard }: { node?: string; wizard?: WizardStep }) {
  return (
    <ReactFlowProvider>
      <CanvasPageBody node={node} wizard={wizard} />
    </ReactFlowProvider>
  );
}

function CanvasPageBody({ node, wizard }: { node?: string; wizard?: WizardStep }) {
  const navigate = useNavigate();
  const camera = useCamera();
  const { phase, error, topology, retry, retryApp, settled } = useTopology();
  const select = useCallback(
    (id?: string) =>
      void navigate({
        to: '/dashboard/canvas',
        search: (s: Record<string, unknown>) => ({ ...s, node: id }),
        replace: true,
      }),
    [navigate]
  );
  const setWizard = useCallback(
    (step?: WizardStep) =>
      void navigate({
        to: '/dashboard/canvas',
        search: (s: Record<string, unknown>) => ({ ...s, wizard: step }),
        replace: true,
      }),
    [navigate]
  );
  const { seeds, launches, seed, onChange: onLaunchChange } = useLaunches();
  // Set by a launch in this visit, never restored: a stored seed for an app
  // since deleted must not hold an empty account on a spinner.
  const [justLaunched, setJustLaunched] = useState(false);
  // Empty accounts open on the front door; elsewhere the wizard is on demand.
  // Right after a launch the account is still empty until the app list
  // refetches, and the front door must not flash back in that moment.
  const wizardStep: WizardStep | undefined =
    wizard ?? (phase === 'empty' && !justLaunched ? 'start' : undefined);
  const cardRef = useRef<HTMLDivElement>(null);
  // The card about to become the new app's node.
  const [morph, setMorph] = useState<{ from: DOMRect; slug: string }>();
  const onLaunched = useCallback(
    (s: LaunchSeed) => {
      const from = cardRef.current?.getBoundingClientRect();
      if (from) setMorph({ from, slug: s.slug });
      seed(s);
      setJustLaunched(true);
      setWizard(undefined);
    },
    [seed, setWizard]
  );

  const { deployGit } = useCreateAndDeploy();
  // Opening a launch's logs remounts the inspector on its Logs tab.
  const [logsFor, setLogsFor] = useState<{ id: string; n: number }>();
  const onLaunchAction = useCallback(
    (slug: string, action: 'retry' | 'logs') => {
      if (action === 'logs') {
        const id = `app:${slug}`;
        select(id);
        setLogsFor((p) => ({ id, n: (p?.n ?? 0) + 1 }));
        // The inspector takes the right edge; once it has, keep the node in view.
        window.setTimeout(() => camera.ensureVisible([id]), 260);
        return;
      }
      const s = seeds[slug];
      // A CLI deploy is retried from the terminal: show the commands again.
      if (!s?.repo) return setWizard('cli');
      const attempt = (s.attempt ?? 0) + 1;
      void deployGit({ slug, repo: s.repo, ref: s.ref ?? 'main' }).then(
        (dep) => seed({ ...s, attempt, deploymentId: dep.id, submitError: undefined }),
        (err: unknown) =>
          seed({ ...s, attempt, deploymentId: undefined, submitError: errorMessage(err) })
      );
    },
    [seeds, deployGit, seed, select, setWizard, camera]
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
  const heights = useMemo(
    () =>
      new Map(
        Object.values(launches)
          .filter((l) => l.stage !== 'live')
          .map((l) => [`app:${l.slug}`, l.stage === 'failed' ? APP_FAILED : APP_TALL])
      ),
    [launches]
  );
  // One next step after a first deploy goes live: ghosts around that app,
  // until something is added to it or they are waved off.
  const [retiredTick, setRetiredTick] = useState(0);
  const retire = useCallback((slug: string) => {
    try {
      localStorage.setItem(`gregale.canvas.ghosts.${slug}`, 'done');
    } catch {
      // Without storage the ghosts still go for this visit.
    }
    setRetiredTick((n) => n + 1);
  }, []);
  const ghostApp = useMemo(() => {
    void retiredTick;
    const live = Object.values(launches).filter(
      (l) =>
        l.stage === 'live' &&
        topology.nodes.some((n) => n.id === `app:${l.slug}`) &&
        !ghostsRetired(l.slug)
    );
    return live.at(-1)?.slug;
  }, [launches, topology.nodes, retiredTick]);
  // Hovering the app shows all three; the pointer crossing to a ghost passes
  // over empty canvas, so leaving waits a beat before they fold away.
  const [hovered, setHovered] = useState<string>();
  const leaving = useRef(0);
  const onHover = useCallback((id?: string) => {
    window.clearTimeout(leaving.current);
    if (id) setHovered(id);
    else leaving.current = window.setTimeout(() => setHovered(undefined), 350);
  }, []);
  useEffect(() => () => window.clearTimeout(leaving.current), []);
  const ghostsShown = ghostApp && !connect && !wizardStep && !morph ? ghostApp : undefined;
  const ghostAll =
    Boolean(ghostsShown) &&
    (hovered === `app:${ghostsShown}` ||
      Boolean(hovered?.startsWith('ghost:')) ||
      node === `app:${ghostsShown}`);
  const ghosts = useMemo(
    () => (ghostsShown ? { slug: ghostsShown, all: ghostAll } : undefined),
    [ghostsShown, ghostAll]
  );

  const ghostRoom = ghostApp && `app:${ghostApp}`;
  const positions = useMemo(
    () => layout(topology, { draft: slot, heights, ghostRoom }),
    [topology, slot, heights, ghostRoom]
  );

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
        launches,
        onLaunchAction,
        ghosts,
        onGhost: (slug, kind) => setConnect({ slug, side: kind === 'bucket' ? 'out' : 'in', kind }),
        onDismissGhosts: () => ghostApp && retire(ghostApp),
      }),
    [topology, positions, retryApp, node, launches, onLaunchAction, ghosts, ghostApp, retire]
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
                  onDone: () => {
                    // Something real was added: the suggestions have done their job.
                    if (connect.slug === ghostApp) retire(connect.slug);
                    setConnect(undefined);
                  },
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
    [connect, appData, anchor, appId, flow, positions, ghostApp, retire]
  );
  const selected = topology.nodes.find((n) => n.id === node);
  const selectedLaunch =
    selected?.data.kind === 'app' ? launches[(selected.data as AppData).slug] : undefined;
  const openOnLogs = selected && logsFor?.id === selected.id && selectedLaunch?.stage !== 'live';
  const inspectorTab: InspectorTab = openOnLogs ? 'logs' : 'overview';
  const appSlugs = useMemo(
    () =>
      new Set(
        topology.nodes.flatMap((n) => (n.data.kind === 'app' ? [(n.data as AppData).slug] : []))
      ),
    [topology.nodes]
  );
  const gaps = useMemo(() => summarizeIssues(topology.issues), [topology.issues]);

  const morphId = morph && `app:${morph.slug}`;
  const morphArrived = Boolean(morph && appSlugs.has(morph.slug));
  // The real node waits, invisible, under the box until the box lands on it.
  const shown = useMemo(
    () =>
      morphId
        ? {
            ...withDraft,
            nodes: withDraft.nodes.map((n) =>
              n.id === morphId ? { ...n, style: { ...n.style, opacity: 0 } } : n
            ),
          }
        : withDraft,
    [withDraft, morphId]
  );
  const morphTo = useCallback(
    () =>
      document
        .querySelector<HTMLElement>(`.react-flow__node[data-id="${morphId}"] .canvas-node`)
        ?.getBoundingClientRect() ?? null,
    [morphId]
  );
  const endMorph = useCallback(() => setMorph(undefined), []);
  // A new app lands at the end of the graph: bring it on screen for the box.
  useEffect(() => {
    if (!morphArrived || !morphId) return;
    const id = window.setTimeout(() => camera.ensureVisible([morphId]), 60);
    return () => window.clearTimeout(id);
  }, [morphArrived, morphId, camera]);
  // If the app list never brings the app (a failed refetch), let the card go.
  useEffect(() => {
    if (!morph || morphArrived) return;
    const id = window.setTimeout(endMorph, 8_000);
    return () => window.clearTimeout(id);
  }, [morph, morphArrived, endMorph]);

  return (
    <div data-gregale-canvas="" className="relative h-full">
      {morph && (
        <Morph
          from={morph.from}
          to={morphTo}
          slug={morph.slug}
          hold={!morphArrived}
          onDone={endMorph}
        />
      )}
      {Object.values(seeds)
        // Only apps the account has: a stale seed for a deleted app is ignored.
        .filter((s) => appSlugs.has(s.slug))
        .map((s) => (
          <LaunchTracker
            key={`${s.slug}:${s.deploymentId ?? ''}:${s.attempt ?? 0}`}
            seed={s}
            onChange={onLaunchChange}
          />
        ))}
      <p className="m-6 text-sm text-muted-foreground md:hidden">
        The canvas needs a wider screen. Every resource is still on its own page.
      </p>
      <div className="hidden h-full md:flex">
        {phase === 'loading' && <LoadingState message="Loading canvas…" className="m-6 flex-1" />}
        {phase === 'unreachable' && <UnreachableState onRetry={retry} className="m-6 flex-1" />}
        {phase === 'error' && <ErrorState error={error} onRetry={retry} className="m-6 flex-1" />}
        {(phase === 'empty' || phase === 'ready') && (
          <>
            {/* One tree for both phases: creating the first app flips the
                phase mid-wizard, and the wizard must not remount and lose
                its step's state when it does. */}
            <div className={cn('relative flex-1', phase === 'empty' && 'canvas-surface')}>
              {phase === 'empty' && !wizardStep && !morph && (
                <LoadingState message="Placing your app…" className="m-6" />
              )}
              {phase === 'ready' && gaps.length > 0 && (
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
              {phase === 'ready' && (
                <CanvasView
                  nodes={shown.nodes}
                  edges={shown.edges}
                  selected={node}
                  onSelect={select}
                  settled={settled}
                  onHover={onHover}
                  onNew={() => setWizard('start')}
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
              )}
              {wizardStep && (
                <Wizard
                  step={wizardStep}
                  mode={phase === 'empty' ? 'empty' : 'new'}
                  apps={topology.nodes
                    .filter((n) => n.data.kind === 'app')
                    .map((n) => (n.data as AppData).slug)}
                  onStep={setWizard}
                  onLaunched={onLaunched}
                  onPickExisting={(slug, kind) => {
                    setWizard(undefined);
                    setConnect({ slug, side: kind === 'bucket' ? 'out' : 'in', kind });
                  }}
                  cardRef={cardRef}
                />
              )}
            </div>
            {phase === 'ready' && selected && (
              <Inspector
                key={openOnLogs ? `${selected.id}:${logsFor.n}` : selected.id}
                node={selected}
                launch={selectedLaunch}
                initialTab={inspectorTab}
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
