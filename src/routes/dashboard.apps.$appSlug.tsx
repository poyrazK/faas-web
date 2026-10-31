import {
  APP_TAB_CAPABILITY,
  AppTabNavigation,
  appTabPanelLabel,
  resolveAppTab,
  visibleAppTabs,
  type AppTab,
} from '@/components/dashboard/app-tab-navigation';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { useCapabilityRegistry } from '@/lib/api/capabilities';
import { capabilityAccess } from '@/lib/capability-state';
import { AutomationsBody } from '@/components/dashboard/automations-body';
import { automationSearchPatch, validateJobsSearch } from '@/components/dashboard/jobs-search';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { createFileRoute, useParams } from '@tanstack/react-router';
import { Rocket } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  RangeSelector,
  StatTile,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { formatCompact, formatMs } from '@/lib/mock-data';
import {
  useAppDeployments,
  useAppMetrics,
  useBuildRecords,
  type MetricsRange,
} from '@/lib/api/queries';
import { toDeployment } from '@/lib/api/adapters';
import { useData } from '@/lib/store';
import { useAuth } from '@/lib/auth';
import { isPaidPlan } from '@/lib/plan';
import { LogsBody } from './dashboard.logs';
import {
  logFilters,
  logsSearch,
  logsSearchPatch,
  validateLogsSearch,
  type LogsSearch,
} from '@/components/dashboard/logs-search';
import { RoutesBody } from './dashboard.routes';
import { SecretsBody } from './dashboard.secrets';
import { EnvBody } from './dashboard.env';
import { ConfigHistory } from '@/components/dashboard/config-history';
import { QueuesBody } from './dashboard.queues';
import { UpstreamsBody } from './dashboard.upstreams';
import { AlertsBody } from './dashboard.alerts';
import { DebugBody } from '@/components/dashboard/debug-body';
import { WakeDrawer } from '@/components/dashboard/wake-drawer';
import { validateDebugSearch, type DebugSearch } from '@/components/dashboard/debug-search';
import { RequestAuditBody } from '@/components/dashboard/request-audit';
import { MirrorsBody } from './dashboard.mirrors';
import { TenantSurfacesBody } from './dashboard.tenant-surfaces';
import { ApiConsumers } from '@/components/dashboard/api-consumers';
import { ApiConsumerPlans } from '@/components/dashboard/api-consumer-plans';
import { OpenAPIBody } from './dashboard.openapi';
import { WebhooksHub } from './dashboard.webhooks';
import { EdgeRulesBody } from './dashboard.edge-rules';
import { ErrorsBody } from '@/components/dashboard/errors-body';
import { LogDrainsBody } from '@/components/dashboard/log-drains';
import { IssuesBody } from '@/components/dashboard/issues-body';
import { ServiceBindings } from '@/components/dashboard/service-bindings';
import { BindingReleasePolicy } from '@/components/dashboard/binding-release-policy';
import { BindingVerificationRuns } from '@/components/dashboard/binding-verification-runs';
import { QueueCanaries } from '@/components/dashboard/queue-canaries';
import { McpGuidance } from '@/components/dashboard/mcp-guidance';
import { validateIssueSearch, type IssueSearch } from '@/components/dashboard/issues-search';
import { AppConfiguration } from '@/components/dashboard/app-configuration';
import { PrewarmPanel } from '@/components/dashboard/prewarm';
import { GitHubConnectionPanel } from '@/components/dashboard/github-connection';
import { InvokePanel, SloPanel } from '@/components/dashboard/app-core-panels';
import { AppUsagePanel, WakeTimelinePanel } from '@/components/dashboard/app-insights';
import { AppAnalyticsPanel } from '@/components/dashboard/app-analytics';
import {
  AppHealthPanel,
  AwakeRoutesPanel,
  DependencyLatencyPanel,
} from '@/components/dashboard/app-observability';
import { AppOverview } from '@/components/dashboard/app-overview';
import { StatelessContract } from '@/components/dashboard/stateless-contract';
import { PreviewDiscovery } from '@/components/dashboard/projects/preview-workload-set';
import { AppHeader } from '@/components/dashboard/app-header';
import { useProjectMembership } from '@/lib/api/projects';
import { AppActionsMenu } from '@/components/dashboard/app-actions-menu';
import { TarballDeploy } from '@/components/dashboard/tarball-deploy';
import { ImageDeploymentPanel } from '@/components/dashboard/image-deploy-form';
import { Swap } from '@/components/dashboard/motion';
import { DeployFromGitModal } from '@/components/dashboard/deploy-from-git-modal';
import { DeploymentProgress } from '@/components/dashboard/deployment-progress';
import { ReleaseDetailPanel } from '@/components/dashboard/release-detail';
import {
  validateReleasesSearch,
  type ReleaseSection,
} from '@/components/dashboard/releases-search';
import { AppActivityTimeline } from '@/components/dashboard/resource-activity';
import { DeploymentHistoryPanel } from '@/components/dashboard/deployment-history';
import { ClearObsoleteDeploymentsButton } from '@/components/dashboard/deployment-actions';
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
type Tab = AppTab;

/** One half of the Environment page — env vars and secrets share it. */
function EnvironmentSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

function DeploymentCapability({
  slug,
  resource,
  phase,
  error,
  hasRunnable,
  onRetry,
  children,
}: {
  slug: string;
  resource: 'Invoke' | 'Logs';
  phase: ReturnType<typeof queryPhase>;
  error: unknown;
  hasRunnable: boolean;
  onRetry: () => void;
  children: ReactNode;
}) {
  if (phase === 'unreachable') return <UnreachableState onRetry={onRetry} />;
  if (phase === 'error') return <ErrorState error={error} onRetry={onRetry} />;
  if (phase === 'loading') return <LoadingState message="Loading deployment history…" />;
  if (!hasRunnable) return <DeploymentGate slug={slug} resource={resource} />;
  return <>{children}</>;
}

export const Route = createFileRoute('/dashboard/apps/$appSlug')({
  head: () => pageHead({ title: 'App' }),
  // Tab lives in the URL, so a refresh or a shared link lands on the same one.
  // Optional, so links elsewhere need not pass it and the default tab leaves
  // no query string behind.
  validateSearch: (
    search: Record<string, unknown>
  ): DebugSearch &
    LogsSearch &
    IssueSearch &
    ReturnType<typeof automationSearchPatch> & {
      tab?: Tab;
      deployment?: string;
      releaseSection?: ReleaseSection;
      webhookDirection?: 'inbound' | 'outbound';
    } => ({
    ...validateDebugSearch(search),
    ...automationSearchPatch(validateJobsSearch(search)),
    ...logsSearchPatch(validateLogsSearch(search)),
    ...validateIssueSearch(search),
    tab: resolveAppTab(search.tab),
    deployment:
      typeof search.deployment === 'string' && search.deployment ? search.deployment : undefined,
    releaseSection: validateReleasesSearch({ ...search, build: undefined }).releaseSection,
    webhookDirection: search.webhookDirection === 'inbound' ? 'inbound' : undefined,
  }),
  component: FunctionDetailPage,
});

function FunctionDetailPage() {
  const { appSlug } = useParams({ from: '/dashboard/apps/$appSlug' });
  const search = Route.useSearch();
  const { tab = 'Overview', deployment: selectedDeploymentId, releaseSection } = search;
  // Tabs whose capability apid hides for this account (faas capgate, #5319).
  const registry = useCapabilityRegistry();
  const visibleTabs = visibleAppTabs((id) =>
    capabilityAccess(registry.query.data, id, registry.phase)
  );
  const tabCapability = APP_TAB_CAPABILITY[tab];
  const navigate = Route.useNavigate();
  // Preserve nested investigations when the operator leaves and returns to a tab.
  const setTab = (next: Tab) =>
    navigate({ search: (current) => ({ ...current, tab: next }), hash: true });
  useEffect(() => {
    if (search.tab === 'Logs' && search.mode === 'archive' && !search.date) {
      void navigate({
        replace: true,
        search: (current) => ({ ...current, ...logsSearchPatch(logsSearch(logFilters(search))) }),
        hash: true,
      });
    }
  }, [search, navigate]);
  const tabsId = useId();
  const [range, setRange] = useState<MetricsRange>('24h');
  const { getWorkflow, loading, error, refresh } = useData();
  const { account, loading: authLoading } = useAuth();
  const membership = useProjectMembership(account?.id ?? '');
  const appDeploymentQuery = useAppDeployments(appSlug);
  const [deployOpen, setDeployOpen] = useState(false);
  const [activeDeployment, setActiveDeployment] = useState<{
    id: string;
    repo: string;
    ref: string;
  } | null>(null);
  const [deploySubmissionError, setDeploySubmissionError] = useState<string | null>(null);

  const fn = getWorkflow(appSlug);
  // The route's `head` can only name the id, so the real name is applied here
  // once the store resolves it. Above the early return — it is a hook.
  useDocumentTitle(fn?.name ?? 'App not found');

  // Real per-app aggregates for the Metrics tab. Called with the slug, which is
  // what `appSlug` is.
  const paidAccess = account !== null && isPaidPlan(account.plan);
  const metrics = useAppMetrics(appSlug, tab === 'Overview' ? '24h' : range, {
    enabled: paidAccess && (tab === 'Overview' || tab === 'Metrics'),
  });
  const metricsDegraded = Boolean(metrics.data && metrics.data.source !== 'prometheus');
  const metricsTileState = metrics.isPending
    ? ('loading' as const)
    : metrics.error || metricsDegraded
      ? ('unavailable' as const)
      : ('ready' as const);
  const metricsPhase = queryPhase({ error: metrics.error, loading: metrics.isPending });
  // The deployment history is app-scoped and paged, so resolve build records
  // for the rows that are actually visible instead of joining against the
  // account-wide first build page. This keeps older app releases from losing
  // their timing and avoids fetching another app's build evidence.
  const deploymentItems = useMemo(
    () => appDeploymentQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [appDeploymentQuery.data]
  );
  const buildIds = useMemo(
    () => [
      ...new Set(
        deploymentItems.flatMap((deployment) => (deployment.build_id ? [deployment.build_id] : []))
      ),
    ],
    [deploymentItems]
  );
  const buildRecords = useBuildRecords(tab === 'Deployments' ? buildIds : []);
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
    for (const result of buildRecords) {
      const build = result.data;
      if (!build) continue;
      byDeployment.set(build.deployment_id, {
        durationSeconds: build.duration_seconds,
        enqueuedAt: build.enqueued_at,
        startedAt: build.started_at,
        finishedAt: build.finished_at,
      });
    }
    return byDeployment;
  }, [buildRecords]);
  const buildIdsByDeployment = useMemo(() => {
    const byDeployment = new Map<string, string>();
    for (const result of buildRecords) {
      const build = result.data;
      if (build) byDeployment.set(build.deployment_id, build.id);
    }
    return byDeployment;
  }, [buildRecords]);

  const deployments = useMemo(() => {
    const appId = deploymentItems[0]?.app_id;
    const slugById = appId ? new Map([[appId, appSlug]]) : new Map<string, string>();
    return deploymentItems.map((deployment) => toDeployment(deployment, slugById));
  }, [deploymentItems, appSlug]);
  // Keep a stale loaded page usable while a later page is being fetched, but
  // never turn an initial deployment read failure into an undeployed gate.
  const deploymentError = deployments.length === 0 ? appDeploymentQuery.error : undefined;
  const deploymentPhase = queryPhase({
    error: deploymentError,
    loading: appDeploymentQuery.isPending,
    isEmpty: deployments.length === 0,
  });

  // Order matters: the app list arrives over the network now, so "not in the
  // list" means "not loaded yet" until the request settles. Claiming 404 first
  // would flash a wrong answer on every cold navigation.
  if (error) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={appSlug} />
        <ErrorState error={error} onRetry={refresh} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={appSlug} />
        <LoadingState />
      </div>
    );
  }

  if (!fn) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="App not found" />
        <EmptyState message="This app does not exist or has been deleted." />
      </div>
    );
  }

  const releases = {
    data: deploymentItems,
    isPending: appDeploymentQuery.isPending,
    error: appDeploymentQuery.error,
  };
  const hasRunnable = hasRunnableDeployment(deployments);
  const canRollback = hasRollbackTarget(deployments);
  const isDeploying =
    fn.state === 'deploying' || deployments.some((deployment) => deployment.state === 'building');

  return (
    <div className="flex flex-col gap-6">
      <AppHeader
        app={fn}
        releases={releases}
        project={membership.projectOfApp.get(appSlug)}
        actions={
          <>
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
              {isDeploying ? 'Deploying…' : 'Deploy'}
            </Button>
            <AppActionsMenu app={fn} canRollback={canRollback} isDeploying={isDeploying} />
          </>
        }
      />
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

      <AppTabNavigation
        tab={tab}
        onSelect={(next) => void setTab(next)}
        panelId={`${tabsId}-panel`}
        visible={visibleTabs}
      />

      <div
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={appTabPanelLabel(`${tabsId}-panel`, tab)}
      >
        {/* Keyed by tab, so switching cross-fades the panel in rather than
            hard-swapping — the tab strip above stays put either way. */}
        <Swap id={tab}>
          <TabCapabilityGate capability={tabCapability} title={tab}>
            <div className="flex flex-col gap-6">
              {tab === 'Automations' && (
                <AutomationsBody
                  fixedSlug={appSlug}
                  search={search}
                  onSelection={(patch) => {
                    void navigate({
                      search: (current) => ({
                        ...current,
                        ...automationSearchPatch({ ...current, ...patch }),
                      }),
                      hash: true,
                    });
                  }}
                />
              )}
              {tab === 'Overview' && <PreviewDiscovery slug={appSlug} />}
              {tab === 'Overview' && (
                <AppOverview
                  app={fn}
                  releases={releases}
                  metrics={metrics}
                  metricsAccess={
                    authLoading || account === null
                      ? 'checking'
                      : paidAccess
                        ? 'available'
                        : 'restricted'
                  }
                  onNavigate={(next, id) =>
                    void navigate({
                      search: (current) => ({
                        ...current,
                        tab: next,
                        ...(id ? { deployment: id, releaseSection: 'overview' as const } : {}),
                      }),
                      hash: true,
                      resetScroll: false,
                    })
                  }
                  onDeploy={() => {
                    setDeploySubmissionError(null);
                    setDeployOpen(true);
                  }}
                  onRetryReleases={() => void appDeploymentQuery.refetch()}
                  onRetryMetrics={() => void metrics.refetch()}
                />
              )}
              {tab === 'Overview' && <StatelessContract slug={appSlug} />}
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
                          Metrics are degraded ({metrics.data?.source}), so no figures can be read
                          for this window.
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
                    <AppHealthPanel slug={fn.id} />
                    <SloPanel slug={fn.id} />
                    <AppAnalyticsPanel slug={fn.id} />
                    <div className="grid gap-4 xl:grid-cols-2">
                      <AwakeRoutesPanel slug={fn.id} since="7d" />
                      <DependencyLatencyPanel slug={fn.id} since="24h" />
                    </div>
                    <WakeTimelinePanel
                      slug={fn.id}
                      onOpenWake={(wake) =>
                        void navigate({
                          search: (current) => ({ ...current, wake }),
                          hash: true,
                          resetScroll: false,
                        })
                      }
                    />
                    <AppUsagePanel slug={fn.id} />
                  </div>
                ))}

              {tab === 'Invoke' && (
                <DeploymentCapability
                  slug={fn.id}
                  resource="Invoke"
                  phase={deploymentPhase}
                  error={deploymentError}
                  hasRunnable={hasRunnable}
                  onRetry={() => void appDeploymentQuery.refetch()}
                >
                  <InvokePanel slug={fn.id} />
                </DeploymentCapability>
              )}

              {tab === 'Deployments' && (
                <>
                  <ImageDeploymentPanel key={appSlug} slug={appSlug} />
                  <DeploymentHistoryPanel
                    slug={fn.id}
                    selectedDeploymentId={selectedDeploymentId}
                    buildTimings={buildTimings}
                    onSelect={(id) =>
                      void navigate({
                        search: (current) => ({
                          ...current,
                          tab: 'Deployments',
                          deployment: id,
                          releaseSection: undefined,
                        }),
                        hash: true,
                        resetScroll: false,
                      })
                    }
                    actions={<ClearObsoleteDeploymentsButton slug={fn.id} />}
                  />
                  <Panel
                    title="Deploy an archive"
                    description="For source that is not in a connected repository — the console's half of `gregale deploy --tarball`."
                  >
                    <TarballDeploy
                      slug={fn.id}
                      onDeployed={(id) =>
                        void navigate({
                          search: (current) => ({
                            ...current,
                            tab: 'Deployments',
                            deployment: id,
                            releaseSection: undefined,
                          }),
                          hash: true,
                          replace: true,
                        })
                      }
                    />
                  </Panel>
                  {selectedDeploymentId && (
                    <ReleaseDetailPanel
                      key={selectedDeploymentId}
                      deploymentId={selectedDeploymentId}
                      appSlug={fn.id}
                      timing={buildTimings.get(selectedDeploymentId)}
                      fallbackBuildId={buildIdsByDeployment.get(selectedDeploymentId)}
                      section={releaseSection ?? 'overview'}
                      onSectionChange={(next) =>
                        void navigate({
                          search: (current) => ({ ...current, releaseSection: next }),
                          hash: true,
                          resetScroll: false,
                        })
                      }
                      onClose={() =>
                        void navigate({
                          search: (current) => ({
                            ...current,
                            tab: 'Deployments',
                            deployment: undefined,
                            releaseSection: undefined,
                          }),
                          hash: true,
                          resetScroll: false,
                        })
                      }
                    />
                  )}
                </>
              )}

              {tab === 'Activity' && <AppActivityTimeline slug={fn.id} />}
              {tab === 'Logs' && (
                <DeploymentCapability
                  slug={fn.id}
                  resource="Logs"
                  phase={deploymentPhase}
                  error={deploymentError}
                  hasRunnable={hasRunnable}
                  onRetry={() => void appDeploymentQuery.refetch()}
                >
                  <LogsBody
                    slug={fn.id}
                    filters={logFilters(search)}
                    onFilters={(filters, replace) => {
                      void navigate({
                        replace,
                        search: (current) => ({
                          ...current,
                          ...logsSearchPatch(logsSearch(filters)),
                        }),
                        hash: true,
                      });
                    }}
                  />
                </DeploymentCapability>
              )}
              {tab === 'Log drains' && <LogDrainsBody slug={fn.id} />}
              {tab === 'Errors' && <ErrorsBody slug={fn.id} />}
              {tab === 'Issues' && (
                <IssuesBody
                  accountId={account?.id ?? ''}
                  slug={fn.id}
                  search={search}
                  onSearch={(patch) =>
                    void navigate({
                      search: (current) => ({ ...current, ...patch }),
                      hash: true,
                      resetScroll: false,
                    })
                  }
                />
              )}
              {tab === 'Routes' && (
                <RoutesBody
                  slug={fn.id}
                  baseUrl={fn.visibility === 'internal' ? undefined : fn.url}
                />
              )}
              {tab === 'Environment' && (
                <>
                  <EnvironmentSection
                    title="Variables"
                    description="Plain configuration the app reads at start. Values are visible to anyone with access to this app."
                  >
                    <EnvBody slug={fn.id} />
                  </EnvironmentSection>
                  <EnvironmentSection
                    title="Secrets"
                    description="Sealed at rest and write-only: once saved, a value can be replaced or rotated but never read back."
                  >
                    <SecretsBody slug={fn.id} />
                  </EnvironmentSection>
                  <EnvironmentSection
                    title="History"
                    description="Every change to variables and secrets is a revision you can roll back to, and the config guard undoes a change that breaks the app."
                  >
                    <ConfigHistory slug={fn.id} />
                  </EnvironmentSection>
                </>
              )}
              {tab === 'Queues' && <QueuesBody slug={fn.id} />}
              {tab === 'Upstreams' && <UpstreamsBody slug={fn.id} />}
              {tab === 'Services' && (
                <div className="space-y-5">
                  <ServiceBindings slug={fn.id} />
                  <BindingReleasePolicy slug={fn.id} />
                  <BindingVerificationRuns slug={fn.id} />
                  <QueueCanaries slug={fn.id} />
                </div>
              )}
              {tab === 'MCP' && <McpGuidance key={appSlug} slug={appSlug} />}
              {tab === 'Alerts' && <AlertsBody slug={fn.id} />}
              {tab === 'Webhooks' && (
                <WebhooksHub
                  accountId={account?.id ?? ''}
                  slug={fn.id}
                  direction={search.webhookDirection ?? 'outbound'}
                  onDirection={(next) =>
                    void navigate({
                      search: (current) => ({
                        ...current,
                        webhookDirection: next === 'inbound' ? 'inbound' : undefined,
                      }),
                      hash: true,
                    })
                  }
                />
              )}
              {tab === 'Edge rules' && <EdgeRulesBody slug={fn.id} />}
              {tab === 'Debugger' && (
                <DebugBody
                  slug={fn.id}
                  search={search}
                  onSelect={(patch) =>
                    void navigate({
                      search: (current) => ({ ...current, ...patch }),
                      hash: true,
                      resetScroll: false,
                    })
                  }
                />
              )}
              {tab === 'Request audit' && <RequestAuditBody slug={fn.id} />}
              {tab === 'Mirrors' && <MirrorsBody slug={fn.id} />}
              {tab === 'Tenant surfaces' && <TenantSurfacesBody slug={fn.id} />}
              {tab === 'OpenAPI' && <OpenAPIBody slug={fn.id} />}
              {tab === 'Consumers' && <ApiConsumers slug={fn.id} />}
              {tab === 'Consumer plans' && <ApiConsumerPlans slug={fn.id} />}

              {tab === 'Configuration' && (
                <>
                  {/* Source first: AppConfiguration ends in the danger zone. */}
                  <GitHubConnectionPanel slug={fn.id} />
                  <AppConfiguration slug={fn.id} />
                  <PrewarmPanel slug={fn.id} />
                </>
              )}
            </div>
          </TabCapabilityGate>
        </Swap>
      </div>

      <WakeDrawer
        slug={fn.id}
        wakeId={search.wake}
        onClose={() =>
          void navigate({
            search: (current) => ({ ...current, wake: undefined }),
            replace: true,
            hash: true,
            resetScroll: false,
          })
        }
      />
      <DeployFromGitModal
        open={deployOpen}
        onClose={() => setDeployOpen(false)}
        appSlug={appSlug}
        appName={fn.name}
        onSubmissionError={setDeploySubmissionError}
        onAccepted={(deployment) => {
          setActiveDeployment(deployment);
          void navigate({
            search: (current) => ({
              ...current,
              tab: 'Deployments',
              deployment: deployment.id,
              releaseSection: undefined,
            }),
            hash: true,
            replace: true,
          });
        }}
      />
    </div>
  );
}

/** Gated tab bodies mount only when the account has the tab's capability. */
function TabCapabilityGate({
  capability,
  title,
  children,
}: {
  capability: string | undefined;
  title: string;
  children: ReactNode;
}) {
  if (!capability) return <>{children}</>;
  return (
    <CapabilityGate capability={capability} title={title}>
      {children}
    </CapabilityGate>
  );
}
