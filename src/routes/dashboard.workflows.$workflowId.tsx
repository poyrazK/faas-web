import { useId, useMemo, useRef, useState } from 'react';
import { createFileRoute, Link, useParams } from '@tanstack/react-router';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, OpenNewWindow, Pause, Play, Refresh, Rocket } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  RangeSelector,
  StatTile,
  StateBadge,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { formatCompact, formatMs, formatRelative } from '@/lib/mock-data';
import {
  useAppMetrics,
  useBindRepo,
  useBuilds,
  useDeployFromRef,
  useDeployTarball,
  useParkApp,
  useWakeApp,
  type MetricsRange,
} from '@/lib/api/queries';
import { useData } from '@/lib/store';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { errorMessage } from '@/lib/api/errors';
import { DeployAnnotations } from '@/components/dashboard/deploy-annotations';
import { TarballDeployForm } from '@/components/dashboard/tarball-deploy';
import { annotationsBody, EMPTY_ANNOTATIONS, type AnnotationDraft } from '@/lib/deploy-annotations';
import { useAuth } from '@/lib/auth';
import { isPaidPlan } from '@/lib/plan';
import { cn } from '@/lib/utils';
import { LogsBody } from './dashboard.logs';
import { RoutesBody } from './dashboard.apis';
import { SecretsBody } from './dashboard.secrets';
import { EnvBody } from './dashboard.env';
import { QueuesBody } from './dashboard.queues';
import { UpstreamsBody } from './dashboard.databases';
import { AlertsBody } from './dashboard.alerts';
import { WebhooksBody } from './dashboard.webhooks';
import { EdgeRulesBody } from './dashboard.edge-rules';
import { ErrorsBody } from '@/components/dashboard/errors-body';
import { AppConfiguration } from '@/components/dashboard/app-configuration';
import { InvokePanel, SloPanel } from '@/components/dashboard/app-core-panels';
import { Swap } from '@/components/dashboard/motion';
import { RepoPicker } from '@/components/dashboard/repo-picker';
import { DeploymentProgress } from '@/components/dashboard/deployment-progress';
import { DeploymentDetailPanel } from '@/components/dashboard/deployment-detail';
import { Pill } from '@/components/dashboard/resource-table';
import { Modal } from '@/components/ui/modal';
import { pageHead, useDocumentTitle } from '@/lib/seo';
import { PlanGate } from '@/components/dashboard/plan-gate';
import { DeploymentGate } from '@/components/dashboard/deployment-gate';
import { hasRollbackTarget, hasRunnableDeployment } from '@/lib/deployment-status';

const METRIC_RANGES: MetricsRange[] = ['5m', '15m', '1h', '6h', '24h', '7d', '15d'];

/**
 * Every resource that hangs off one app, in the order an operator reaches for
 * them: what it is doing, what shipped, what it said, then how it is wired.
 *
 * These were nine separate sidebar entries, each with its own app picker —
 * the same "which app?" question answered nine times. The app is in the URL
 * here, so the question is asked once and a shared link lands on the right
 * app and the right tab.
 */
const TABS = [
  'Metrics',
  'Invoke',
  'Deployments',
  'Logs',
  'Errors',
  'Routes',
  'Secrets',
  'Env vars',
  'Queues',
  'Upstreams',
  'Alerts',
  'Webhooks',
  'Edge rules',
  'Configuration',
] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute('/dashboard/workflows/$workflowId')({
  head: () => pageHead({ title: 'Workflow' }),
  // Tab lives in the URL, so a refresh or a shared link lands on the same one.
  // Optional, so links elsewhere need not pass it and the default tab leaves
  // no query string behind.
  validateSearch: (search: Record<string, unknown>): { tab?: Tab; deployment?: string } => ({
    ...(TABS.includes(search.tab as Tab) ? { tab: search.tab as Tab } : {}),
    ...(typeof search.deployment === 'string' && search.deployment
      ? { deployment: search.deployment }
      : {}),
  }),
  component: FunctionDetailPage,
});

function FunctionDetailPage() {
  const { workflowId } = useParams({ from: '/dashboard/workflows/$workflowId' });
  const { tab = 'Metrics', deployment: selectedDeploymentId } = Route.useSearch();
  const navigate = Route.useNavigate();
  // Replace rather than push, so tab switching does not fill the back stack.
  const setTab = (next: Tab) => navigate({ search: { tab: next }, replace: true });
  const tabsId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const reduce = useReducedMotion();
  // Roving focus: arrows move between tabs and select as they go.
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = TABS.length - 1;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    if (next === null) return;
    e.preventDefault();
    tabRefs.current[next]?.focus();
    setTab(TABS[next]);
  };
  const [range, setRange] = useState<MetricsRange>('24h');
  const { getWorkflow, deploymentsFor, redeploy, loading, error, refresh } = useData();
  const { account, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const park = useParkApp();
  const wake = useWakeApp();
  const deployFromRef = useDeployFromRef(workflowId);
  const [deployAnnotations, setDeployAnnotations] = useState<AnnotationDraft>(EMPTY_ANNOTATIONS);
  const deployTarball = useDeployTarball(workflowId);
  const bindRepo = useBindRepo(workflowId);
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployRepo, setDeployRepo] = useState('');
  const [deployRef, setDeployRef] = useState('main');
  const [activeDeployment, setActiveDeployment] = useState<{
    id: string;
    repo: string;
    ref: string;
  } | null>(null);
  const [deploySubmissionError, setDeploySubmissionError] = useState<string | null>(null);
  const confirm = useConfirm();

  const fn = getWorkflow(workflowId);
  // The route's `head` can only name the id, so the real name is applied here
  // once the store resolves it. Above the early return — it is a hook.
  useDocumentTitle(fn?.name ?? 'Function not found');

  // Real per-app aggregates for the Metrics tab. Called with the slug, which is
  // what `workflowId` is.
  const paidAccess = account !== null && isPaidPlan(account.plan);
  const metrics = useAppMetrics(workflowId, range, { enabled: paidAccess });
  const metricsDegraded = Boolean(metrics.data && metrics.data.source !== 'prometheus');
  const metricsTileState = metrics.isPending
    ? ('loading' as const)
    : metrics.error || metricsDegraded
      ? ('unavailable' as const)
      : ('ready' as const);
  const metricsPhase = queryPhase({ error: metrics.error, loading: metrics.isPending });
  const builds = useBuilds({
    // Build duration is not part of DeploymentResponse. Poll the companion
    // records alongside deployments while any visible build is unfinished.
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((build) => build.status === 'queued' || build.status === 'running')
        ? 2_500
        : false;
    },
  });
  const buildTimings = useMemo(() => {
    const byDeployment = new Map<
      string,
      {
        durationSeconds?: number;
        enqueuedAt: string;
        startedAt?: string;
        finishedAt?: string;
      }
    >();
    for (const build of builds.data?.items ?? []) {
      byDeployment.set(build.deployment_id, {
        durationSeconds: build.duration_seconds,
        enqueuedAt: build.enqueued_at,
        startedAt: build.started_at,
        finishedAt: build.finished_at,
      });
    }
    return byDeployment;
  }, [builds.data]);

  // Order matters: the app list arrives over the network now, so "not in the
  // list" means "not loaded yet" until the request settles. Claiming 404 first
  // would flash a wrong answer on every cold navigation.
  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={workflowId} />
        <ErrorState error={error} onRetry={refresh} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={workflowId} />
        <LoadingState />
      </div>
    );
  }

  if (!fn) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Function not found" />
        <EmptyState message="This function does not exist or has been deleted." />
      </div>
    );
  }

  const deployments = deploymentsFor(fn.id);
  const selectedDeployment = selectedDeploymentId
    ? deployments.find((dep) => dep.id === selectedDeploymentId)
    : undefined;
  const hasRunnable = hasRunnableDeployment(deployments);
  const canRollback = hasRollbackTarget(deployments);
  const isDeploying =
    fn.state === 'deploying' || deployments.some((deployment) => deployment.state === 'building');

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/dashboard/workflows"
        className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        All apps
      </Link>

      <PageHeader
        title={fn.name}
        description={[fn.runtime, `${fn.memoryMb} MB`, fn.url].filter(Boolean).join(' · ')}
        actions={
          <>
            <StateBadge state={fn.state} />
            {/* Park and wake were two of the unused hooks: the API has had
                both for as long as the console has existed. */}
            {fn.state === 'running' ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={park.isPending}
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: `Park ${fn.name}?`,
                      description:
                        'Running instances snapshot and release now. The next request wakes it cold — under 350 ms, but not zero.',
                      confirmLabel: 'Park',
                    }))
                  )
                    return;
                  void park
                    .mutateAsync(fn.id)
                    .then(() => toast({ kind: 'success', title: `Parked ${fn.name}` }))
                    .catch((err: unknown) =>
                      toast({
                        kind: 'error',
                        title: 'Could not park',
                        description: errorMessage(err),
                      })
                    );
                }}
              >
                <Pause className="h-3.5 w-3.5" />
                Park
              </Button>
            ) : fn.state === 'idle' ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={wake.isPending}
                onClick={() =>
                  void wake
                    .mutateAsync(fn.id)
                    .then(() => toast({ kind: 'success', title: `Waking ${fn.name}` }))
                    .catch((err: unknown) =>
                      toast({
                        kind: 'error',
                        title: 'Could not wake',
                        description: errorMessage(err),
                      })
                    )
                }
              >
                <Play className="h-3.5 w-3.5" />
                Wake
              </Button>
            ) : null}
            <Button
              size="sm"
              className="gap-1.5"
              disabled={isDeploying}
              onClick={() => {
                setDeploySubmissionError(null);
                setDeployOpen(true);
              }}
            >
              <Rocket className="h-3.5 w-3.5" />
              Deploy
            </Button>
            {canRollback && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={isDeploying}
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: `Roll back ${fn.name}?`,
                      description:
                        'Traffic moves to the previous successful deployment. The current one stays available to roll forward to.',
                      confirmLabel: 'Roll back',
                    }))
                  )
                    return;
                  // `POST /v1/apps/{slug}/rollback` — a real write, so the toast
                  // reports what happened rather than announcing it up front.
                  void redeploy(fn.id)
                    .then(() =>
                      toast({
                        kind: 'success',
                        title: 'Rolled back',
                        description: `${fn.name} is serving its previous deployment.`,
                      })
                    )
                    .catch((err: unknown) =>
                      toast({
                        kind: 'error',
                        title: 'Rollback failed',
                        description: errorMessage(err),
                      })
                    );
                }}
              >
                <Refresh className={cn('h-3.5 w-3.5', isDeploying && 'animate-spin')} />
                {isDeploying ? 'Deploying…' : 'Roll back'}
              </Button>
            )}
          </>
        }
      />

      <a
        href={fn.url}
        className="inline-flex w-fit items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground"
      >
        {fn.url}
        <OpenNewWindow className="h-3 w-3" />
      </a>

      {activeDeployment && (
        <DeploymentProgress
          appCreated
          appName={fn.name}
          deploymentId={activeDeployment.id}
          repo={activeDeployment.repo}
          sourceRef={activeDeployment.ref}
          submissionError={deploySubmissionError}
        />
      )}

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="App detail"
        className="flex gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map((t, i) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${tabsId}-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`${tabsId}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
            onKeyDown={(e) => onTabKeyDown(e, i)}
            className={cn(
              'pressable relative -mb-px whitespace-nowrap px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              tab === t ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t}
            {/* The active underline slides between tabs — one shared element,
                the same spring the sidebar pill rides. Reduced motion keeps a
                static underline per tab. */}
            {tab === t &&
              (reduce ? (
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-brand" />
              ) : (
                <motion.span
                  aria-hidden
                  layoutId="app-tab-underline"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-brand"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              ))}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-tab-${tab}`}>
        {/* Keyed by tab, so switching cross-fades the panel in rather than
            hard-swapping — the tab strip above stays put either way. */}
        <Swap id={tab}>
          <div className="flex flex-col gap-6">
            {tab === 'Metrics' &&
              (authLoading || account === null ? (
                <LoadingState message="Checking plan access…" />
              ) : !paidAccess ? (
                <PlanGate
                  feature="Per-app metrics"
                  description="Request, latency, cold-start, error, and SLO signals are available on Hobby and above."
                />
              ) : (
                <div className="flex flex-col gap-6">
                  <div className="flex justify-end">
                    <RangeSelector
                      value={range}
                      onChange={setRange}
                      options={METRIC_RANGES.map((r) => ({ key: r, label: r }))}
                    />
                  </div>

                  {/* Scalars, not a series: `/v1/apps/{slug}/metrics` returns one
                aggregate per window. The sparkline charts that used to sit here
                were drawn from a seeded PRNG and are gone with it. */}
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {metricsDegraded && (
                      <p
                        className="text-xs text-muted-foreground sm:col-span-2 xl:col-span-4"
                        role="status"
                      >
                        Metrics are degraded ({metrics.data?.source}), so no figures can be read for
                        this window.
                      </p>
                    )}
                    <StatTile
                      label="Requests"
                      value={metrics.data ? formatCompact(metrics.data.request_count) : '—'}
                      state={metricsTileState}
                    />
                    <StatTile
                      label="Error rate"
                      value={metrics.data ? metrics.data.error_rate_pct.toFixed(2) : '—'}
                      unit="%"
                      deltaGood={false}
                      state={metricsTileState}
                    />
                    <StatTile
                      label="Cold starts"
                      value={metrics.data ? metrics.data.cold_start_pct.toFixed(2) : '—'}
                      unit="%"
                      state={metricsTileState}
                    />
                    <StatTile
                      label="Wake p95 (fleet)"
                      value={metrics.data ? formatMs(metrics.data.wake_p95_ms) : '—'}
                      state={metricsTileState}
                    />
                  </div>

                  <Panel
                    title="Response latency"
                    description="2xx traffic over the selected window"
                  >
                    {metricsPhase === 'unreachable' ? (
                      <UnreachableState onRetry={() => void metrics.refetch()} />
                    ) : metricsPhase === 'error' ? (
                      <ErrorState error={metrics.error} onRetry={() => void metrics.refetch()} />
                    ) : metricsPhase === 'loading' ? (
                      <LoadingState message="Querying metrics…" />
                    ) : (
                      <div className="grid gap-4 p-5 sm:grid-cols-3">
                        <StatTile
                          label="p50"
                          value={formatMs(metrics.data?.latency_p50_ms ?? 0)}
                          state={metricsTileState}
                        />
                        <StatTile
                          label="p95"
                          value={formatMs(metrics.data?.latency_p95_ms ?? 0)}
                          state={metricsTileState}
                        />
                        <StatTile
                          label="p99"
                          value={formatMs(metrics.data?.latency_p99_ms ?? 0)}
                          state={metricsTileState}
                        />
                      </div>
                    )}
                  </Panel>
                  <SloPanel slug={fn.id} />
                </div>
              ))}

            {tab === 'Invoke' &&
              (!hasRunnable ? (
                <DeploymentGate slug={fn.id} resource="Invoke" />
              ) : (
                <InvokePanel slug={fn.id} />
              ))}

            {tab === 'Deployments' && (
              <>
                <Panel title="Deployment history" description={`${deployments.length} deployments`}>
                  {deployments.length === 0 ? (
                    <EmptyState message="No deployments yet. Deploy a Git ref or use the CLI." />
                  ) : (
                    <ul className="flex flex-col divide-y divide-border">
                      {deployments.map((dep) => (
                        <li key={dep.id}>
                          <button
                            type="button"
                            onClick={() =>
                              void navigate({
                                search: { tab: 'Deployments', deployment: dep.id },
                                replace: true,
                              })
                            }
                            className="flex w-full flex-wrap items-center gap-3 py-3 text-left transition-colors first:pt-0 last:pb-0 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                          >
                            <Pill
                              label={dep.status ?? dep.state}
                              color={
                                dep.state === 'succeeded'
                                  ? 'var(--status-good)'
                                  : dep.state === 'failed'
                                    ? 'var(--status-critical)'
                                    : 'var(--status-warning)'
                              }
                            />
                            <span className="font-mono text-xs text-muted-foreground">
                              image {dep.version || '—'}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-sm">{dep.message}</span>
                            <span className="w-20 text-right text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
                              {(() => {
                                const seconds = buildTimings.get(dep.id)?.durationSeconds;
                                return seconds == null ? '—' : `${seconds.toFixed(1)}s`;
                              })()}
                            </span>
                            <span className="w-16 text-right text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
                              {formatRelative(dep.createdAt)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
                {selectedDeployment && (
                  <DeploymentDetailPanel
                    deploymentId={selectedDeployment.id}
                    timing={buildTimings.get(selectedDeployment.id)}
                    onClose={() => void navigate({ search: { tab: 'Deployments' }, replace: true })}
                  />
                )}
                <Panel
                  title="Deploy an archive"
                  description="Upload a .tar.gz of the repo root. Same build pipeline as a git deploy."
                >
                  <TarballDeployForm
                    busy={deployTarball.isPending}
                    onSubmit={(file, sidecar) =>
                      void deployTarball
                        .mutateAsync({ file, sidecar })
                        .then((d) => {
                          toast({
                            kind: 'success',
                            title: 'Archive queued',
                            description: `Deployment ${d.id.slice(0, 8)} is building.`,
                          });
                          void refresh();
                        })
                        .catch((err) =>
                          toast({
                            kind: 'error',
                            title: 'Upload failed',
                            description: errorMessage(err),
                          })
                        )
                    }
                  />
                </Panel>
              </>
            )}

            {tab === 'Logs' &&
              (!hasRunnable ? (
                <DeploymentGate slug={fn.id} resource="Logs" />
              ) : (
                <LogsBody slug={fn.id} />
              ))}
            {tab === 'Errors' && <ErrorsBody slug={fn.id} />}
            {tab === 'Routes' && <RoutesBody slug={fn.id} />}
            {tab === 'Secrets' && <SecretsBody slug={fn.id} />}
            {tab === 'Env vars' && <EnvBody slug={fn.id} />}
            {tab === 'Queues' && <QueuesBody slug={fn.id} />}
            {tab === 'Upstreams' && <UpstreamsBody slug={fn.id} />}
            {tab === 'Alerts' && <AlertsBody slug={fn.id} />}
            {tab === 'Webhooks' && <WebhooksBody slug={fn.id} />}
            {tab === 'Edge rules' && <EdgeRulesBody slug={fn.id} />}

            {tab === 'Configuration' && <AppConfiguration slug={fn.id} />}
          </div>
        </Swap>
      </div>

      {/* The one deploy the console can start itself: a Git ref, built
          server-side. The image constructor wants a registry the browser has
          no business holding credentials for. */}
      <Modal
        open={deployOpen}
        onClose={() => setDeployOpen(false)}
        title={`Deploy ${fn.name}`}
        description="Builds the ref from the repository the app is connected to and ships it when the build succeeds."
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDeployOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!/^[^/\s]+\/[^/\s]+$/.test(deployRepo.trim()) || !deployRef.trim()}
              busy={deployFromRef.isPending}
              onClick={() => {
                setDeploySubmissionError(null);
                void deployFromRef
                  .mutateAsync({
                    repo: deployRepo.trim(),
                    ref: deployRef.trim(),
                    format: 'tarball',
                    ...annotationsBody(deployAnnotations),
                  })
                  .then((deployment) => {
                    setActiveDeployment({
                      id: deployment.id,
                      repo: deployRepo.trim(),
                      ref: deployRef.trim(),
                    });
                    setDeployOpen(false);
                    void navigate({
                      search: { tab: 'Deployments', deployment: deployment.id },
                      replace: true,
                    });
                    toast({
                      kind: 'success',
                      title: 'Build accepted',
                      description: `${deployRepo.trim()}@${deployRef.trim()} is queued.`,
                    });
                    // Persist the binding so the next deploy (and GitHub
                    // pushes) know this app's repo. Quiet: failing to bind
                    // must not spoil an accepted build.
                    if (account?.github_install_id) {
                      void bindRepo
                        .mutateAsync({
                          installationId: Number(account.github_install_id),
                          repo: deployRepo.trim(),
                          branch: deployRef.trim() || 'main',
                        })
                        .catch(() => {});
                    }
                  })
                  .catch((err: unknown) => {
                    setDeploySubmissionError(errorMessage(err));
                    toast({
                      kind: 'error',
                      title: 'Could not start the deploy',
                      description: errorMessage(err),
                    });
                  });
              }}
            >
              Deploy
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          {deploySubmissionError && (
            <p role="alert" className="text-xs text-[color:var(--status-critical)]">
              {deploySubmissionError}
            </p>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Repository</span>
            <RepoPicker
              value={deployRepo}
              onChange={(repo, defaultBranch) => {
                setDeployRepo(repo);
                if (defaultBranch) setDeployRef(defaultBranch);
              }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Ref</span>
            <input
              value={deployRef}
              onChange={(e) => setDeployRef(e.target.value)}
              placeholder="main, a tag, or a commit"
              spellCheck={false}
              className="h-9 rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:border-brand/50"
            />
          </label>
          <details>
            <summary className="cursor-pointer text-sm text-muted-foreground">
              Annotations (optional)
            </summary>
            <div className="mt-3">
              <DeployAnnotations value={deployAnnotations} onChange={setDeployAnnotations} />
            </div>
          </details>
        </div>
      </Modal>
    </div>
  );
}
