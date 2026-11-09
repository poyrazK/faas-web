import { AppAnalyticsPreview } from '@/components/dashboard/app-analytics-preview';
import { ApiConsumerPlans } from '@/components/dashboard/api-consumer-plans';
import { ApiConsumers } from '@/components/dashboard/api-consumers';
import { AppActionsMenu } from '@/components/dashboard/app-actions-menu';
import { AppAnalyticsPanel } from '@/components/dashboard/app-analytics';
import {
  validateAppAnalyticsSearch,
  type AppAnalyticsSearch,
} from '@/components/dashboard/app-analytics-search';
import { AppConfiguration } from '@/components/dashboard/app-configuration';
import { InvokePanel } from '@/components/dashboard/app-core-panels';
import { AppHeader } from '@/components/dashboard/app-header';
import { AppHealthPanel } from '@/components/dashboard/app-health';
import { AppUsagePanel, WakeTimelinePanel } from '@/components/dashboard/app-insights';
import { AwakeRoutesPanel, DependencyLatencyPanel } from '@/components/dashboard/app-observability';
import { AppOverview } from '@/components/dashboard/app-overview';
import { AppRetryDefaults } from '@/components/dashboard/app-retry-defaults';
import {
  APP_TAB_CAPABILITY,
  APP_TAB_GROUPS,
  resolveAppTab,
  visibleAppTabs,
  type AppTab,
} from '@/components/dashboard/app-tab-navigation';
import { AutomationsBody } from '@/components/dashboard/automations-body';
import { BindingReleasePolicy } from '@/components/dashboard/binding-release-policy';
import { BindingVerificationRuns } from '@/components/dashboard/binding-verification-runs';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { ConfigHistory } from '@/components/dashboard/config-history';
import { CustomMetricsPanel } from '@/components/dashboard/custom-metrics';
import { DebugBody } from '@/components/dashboard/debug-body';
import { validateDebugSearch, type DebugSearch } from '@/components/dashboard/debug-search';
import { DeployFromGitModal } from '@/components/dashboard/deploy-from-git-modal';
import { ClearObsoleteDeploymentsButton } from '@/components/dashboard/deployment-actions';
import { DeploymentAliasesPanel } from '@/components/dashboard/deployment-aliases';
import { DeploymentGate, NotLiveNotice } from '@/components/dashboard/deployment-gate';
import { DeploymentHistoryPanel } from '@/components/dashboard/deployment-history';
import { DeploymentProgress } from '@/components/dashboard/deployment-progress';
import { EdgeProtectionBody } from '@/components/dashboard/edge-protection';
import { ErrorsBody } from '@/components/dashboard/errors-body';
import { GitHubConnectionPanel } from '@/components/dashboard/github-connection';
import { ImageDeploymentPanel } from '@/components/dashboard/image-deploy-form';
import { IssuesBody } from '@/components/dashboard/issues-body';
import { validateIssueSearch, type IssueSearch } from '@/components/dashboard/issues-search';
import { WorkflowsBody } from '@/components/dashboard/workflows/workflows-body';
import { WorkflowSchedulesBody } from '@/components/dashboard/workflows/workflow-schedules';
import { RecoveryPolicyBody } from '@/components/dashboard/workflows/recovery-policy';
import { WorkflowInsightsBody } from '@/components/dashboard/workflows/workflow-insights';
import { automationSearchPatch, validateJobsSearch } from '@/components/dashboard/jobs-search';
import { HelpTip } from '@/components/dashboard/kit/help-tip';
import { Sheet } from '@/components/dashboard/kit/sheet';
import { LogDrainsBody } from '@/components/dashboard/log-drains';
import {
  logFilters,
  logsSearch,
  logsSearchPatch,
  validateLogsSearch,
  type LogsSearch,
} from '@/components/dashboard/logs-search';
import { SyntheticsBody } from '@/components/dashboard/synthetics-body';
import { RealtimeBody } from '@/components/dashboard/realtime/realtime-body';
import { SlosBody } from '@/components/dashboard/slos-body';
import { ForksBody } from '@/components/dashboard/app-forks';
import { ProfileCapturesBody } from '@/components/dashboard/profile-captures';
import {
  validateProfileCaptureSearch,
  type ProfileCaptureSearch,
} from '@/components/dashboard/profile-captures-search';
import { WakeDrawer } from '@/components/dashboard/wake-drawer';
import { RequestAuditBody } from '@/components/dashboard/request-audit';
import { TcpListeners, UdpListeners } from '@/components/dashboard/listeners';
import { ServiceBindings } from '@/components/dashboard/service-bindings';
import { AppOutboundBindings } from '@/components/dashboard/outbound/app-outbound-bindings';
import { QueueCanaries } from '@/components/dashboard/queue-canaries';
import { McpGuidance } from '@/components/dashboard/mcp-guidance';
import { Swap } from '@/components/dashboard/motion';
import { AlertsBody } from '@/components/dashboard/pages/alerts';
import { EdgeRulesBody } from '@/components/dashboard/pages/edge-rules';
import { EnvBody } from '@/components/dashboard/pages/env';
import { LogsBody } from '@/components/dashboard/pages/logs';
import { MirrorsBody } from '@/components/dashboard/pages/mirrors';
import { OpenAPIBody } from '@/components/dashboard/pages/openapi';
import { QueuesBody } from '@/components/dashboard/pages/queues';
import { RoutesBody } from '@/components/dashboard/pages/routes';
import { SecretsBody } from '@/components/dashboard/pages/secrets';
import { TenantSurfacesBody } from '@/components/dashboard/pages/tenant-surfaces';
import { UpstreamsBody } from '@/components/dashboard/pages/upstreams';
import { WebhooksHub } from '@/components/dashboard/pages/webhooks';
import { PlanGate } from '@/components/dashboard/plan-gate';
import { PrewarmPanel } from '@/components/dashboard/prewarm';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  queryPhase,
  UnreachableState,
} from '@/components/dashboard/primitives';
import { PreviewDiscovery } from '@/components/dashboard/projects/preview-workload-set';
import { ReleaseDetailPanel } from '@/components/dashboard/release-detail';
import {
  validateReleasesSearch,
  type ReleaseSection,
} from '@/components/dashboard/releases-search';
import { AppActivityTimeline } from '@/components/dashboard/resource-activity';
import { StatelessContract } from '@/components/dashboard/stateless-contract';
import { TarballDeploy } from '@/components/dashboard/tarball-deploy';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { toDeployment } from '@/lib/api/adapters';
import { useCapabilityRegistry } from '@/lib/api/capabilities';
import { useProjectMembership } from '@/lib/api/projects';
import { useAppDeployments, useAppMetrics, useBuildRecords } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { capabilityAccess } from '@/lib/capability-state';
import { ReleaseSafety } from '@/components/dashboard/release-safety';
import { pageHead, useDocumentTitle } from '@/lib/seo';
import { hasLogSource, hasRollbackTarget, hasRunnableDeployment } from '@/lib/deployment-status';
import { isPaidPlan } from '@/lib/plan';
import { useData } from '@/lib/store';
import { createFileRoute, useParams } from '@tanstack/react-router';
import { Play, Rocket } from 'iconoir-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

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
/** A section heading with its help tip, and the section's actions on the right. */
function SectionHeading({
  title,
  help,
  actions,
}: {
  title: string;
  help: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <HelpTip label={`About ${title}`}>{help}</HelpTip>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

function EnvironmentSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
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
    ProfileCaptureSearch &
    LogsSearch &
    IssueSearch &
    AppAnalyticsSearch &
    ReturnType<typeof automationSearchPatch> & {
      tab?: Tab;
      /** The Invoke sheet is open. `?tab=Invoke` from before it moved opens it too. */
      invoke?: true;
      deployment?: string;
      releaseSection?: ReleaseSection;
      webhookDirection?: 'inbound' | 'outbound';
      workflowRun?: string;
    } => ({
    ...validateDebugSearch(search),
    ...validateProfileCaptureSearch(search),
    ...automationSearchPatch(validateJobsSearch(search)),
    ...logsSearchPatch(validateLogsSearch(search)),
    ...validateIssueSearch(search),
    ...validateAppAnalyticsSearch(search),
    tab: resolveAppTab(search.tab),
    invoke:
      search.invoke === true ||
      search.invoke === 1 ||
      search.invoke === '1' ||
      search.tab === 'Invoke'
        ? true
        : undefined,
    deployment:
      typeof search.deployment === 'string' && search.deployment ? search.deployment : undefined,
    releaseSection: validateReleasesSearch({ ...search, build: undefined }).releaseSection,
    webhookDirection: search.webhookDirection === 'inbound' ? 'inbound' : undefined,
    workflowRun:
      typeof search.workflowRun === 'string' && search.workflowRun ? search.workflowRun : undefined,
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
  const setInvoke = (open: boolean) =>
    navigate({ search: (current) => ({ ...current, invoke: open || undefined }), hash: true });
  useEffect(() => {
    if (search.tab === 'Logs' && search.mode === 'archive' && !search.date) {
      void navigate({
        replace: true,
        search: (current) => ({ ...current, ...logsSearchPatch(logsSearch(logFilters(search))) }),
        hash: true,
      });
    }
  }, [search, navigate]);
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
  const metrics = useAppMetrics(appSlug, '24h', {
    enabled: paidAccess && tab === 'Overview',
  });
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
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setInvoke(true)}>
              <Play className="h-3.5 w-3.5" />
              Invoke
            </Button>
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

      {/* The rail lists this app's sections; small screens get the same list
          here, since the rail is behind the menu button there. */}
      <Select
        aria-label="Section"
        value={tab}
        onChange={(e) => void setTab(e.target.value as Tab)}
        className="w-full lg:hidden"
      >
        {APP_TAB_GROUPS.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {(group.tabs as readonly Tab[])
              .filter((name) => name === tab || visibleTabs.includes(name))
              .map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
          </optgroup>
        ))}
      </Select>

      <section aria-label={tab}>
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
              {tab === 'Workflows' && (
                <WorkflowsBody
                  slug={fn.id}
                  run={search.workflowRun}
                  onRun={(workflowRun) =>
                    void navigate({
                      search: (current) => ({ ...current, workflowRun }),
                      hash: true,
                    })
                  }
                />
              )}
              {tab === 'Workflow schedules' && (
                <WorkflowSchedulesBody
                  slug={fn.id}
                  onOpenRun={(workflowRun) =>
                    void navigate({
                      search: (current) => ({ ...current, tab: 'Workflows', workflowRun }),
                      hash: true,
                    })
                  }
                />
              )}
              {tab === 'Workflow insights' && <WorkflowInsightsBody slug={fn.id} />}
              {tab === 'Recovery policy' && <RecoveryPolicyBody slug={fn.id} />}
              {tab === 'Overview' && <PreviewDiscovery slug={appSlug} />}
              {tab === 'Overview' && (
                <AppOverview
                  analytics={
                    paidAccess ? (
                      <AppAnalyticsPreview
                        slug={fn.id}
                        since={search.analyticsSince ?? '24h'}
                        onSinceChange={(value) =>
                          void navigate({
                            search: (previous) => ({
                              ...previous,
                              analyticsSince: value as AppAnalyticsSearch['analyticsSince'],
                            }),
                            replace: true,
                            resetScroll: false,
                          })
                        }
                      />
                    ) : undefined
                  }
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
                    <AppAnalyticsPanel
                      slug={fn.id}
                      search={search}
                      onSearchChange={(patch) =>
                        void navigate({
                          search: (current) => ({ ...current, ...patch }),
                          replace: true,
                          hash: true,
                          resetScroll: false,
                        })
                      }
                    />
                    <AppHealthPanel slug={fn.id} />
                    <CustomMetricsPanel slug={fn.id} />
                    <DependencyLatencyPanel slug={fn.id} since={search.analyticsSince ?? '24h'} />
                    <AppUsagePanel slug={fn.id} />
                  </div>
                ))}

              {/* Why the app wakes and how each wake went: its own section, so
                  Metrics ends with the traffic it describes. */}
              {tab === 'Wakes' &&
                (authLoading || account === null ? (
                  <LoadingState message="Checking plan access…" />
                ) : !paidAccess ? (
                  <PlanGate
                    feature="Wake analysis"
                    description="What keeps an app awake, and each wake's timing, are available on Hobby and above."
                  />
                ) : (
                  <div className="flex flex-col gap-5">
                    <AwakeRoutesPanel slug={fn.id} since="7d" />
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
                  </div>
                ))}

              {tab === 'Overview' && <AppHealthPanel slug={fn.id} />}
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
                    cleanup={<ClearObsoleteDeploymentsButton slug={fn.id} />}
                  />
                  <DeploymentAliasesPanel
                    slug={fn.id}
                    onOpenDeployment={(id) =>
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
                  />
                  <Panel
                    title="Deploy an archive"
                    help="For source that is not in a connected repository. The console's half of `gregale deploy --tarball`."
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

              {tab === 'Release safety' && (
                <ReleaseSafety
                  slug={fn.id}
                  onOpenDeployment={(id) =>
                    void navigate({
                      search: (current) => ({
                        ...current,
                        tab: 'Deployments',
                        deployment: id,
                        releaseSection: 'lifecycle',
                      }),
                      hash: true,
                      resetScroll: false,
                    })
                  }
                />
              )}
              {tab === 'Activity' && <AppActivityTimeline slug={fn.id} />}
              {tab === 'Logs' && (
                <DeploymentCapability
                  slug={fn.id}
                  resource="Logs"
                  phase={deploymentPhase}
                  error={deploymentError}
                  hasRunnable={hasLogSource(deployments)}
                  onRetry={() => void appDeploymentQuery.refetch()}
                >
                  {!hasRunnable && <NotLiveNotice slug={appSlug} />}
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
                  <EnvironmentSection title="Variables">
                    <EnvBody
                      slug={fn.id}
                      header={(actions) => (
                        <SectionHeading
                          title="Variables"
                          help="Read at start. Values are visible to anyone with access to this app."
                          actions={actions}
                        />
                      )}
                    />
                  </EnvironmentSection>
                  <EnvironmentSection title="Secrets">
                    <SecretsBody
                      slug={fn.id}
                      header={(actions) => (
                        <SectionHeading
                          title="Secrets"
                          help="Sealed and write-only: a value can be replaced or rotated, never read back."
                          actions={actions}
                        />
                      )}
                    />
                  </EnvironmentSection>
                  <EnvironmentSection title="History">
                    <SectionHeading
                      title="History"
                      help="Every change is a revision you can roll back to. The config guard undoes a change that breaks the app."
                    />
                    <ConfigHistory slug={fn.id} />
                  </EnvironmentSection>
                </>
              )}
              {tab === 'Queues' && <QueuesBody slug={fn.id} />}
              {tab === 'Realtime' && (
                <RealtimeBody
                  slug={fn.id}
                  appUrl={fn.visibility === 'internal' ? undefined : fn.url}
                />
              )}
              {tab === 'Upstreams' && <UpstreamsBody slug={fn.id} />}
              {tab === 'Outbound' && <AppOutboundBindings slug={fn.id} />}
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
              {tab === 'SLOs' && <SlosBody slug={fn.id} />}
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
              {tab === 'Edge protection' && <EdgeProtectionBody slug={fn.id} />}
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
              {tab === 'Forks' && <ForksBody slug={fn.id} />}
              {tab === 'Profile captures' && (
                <ProfileCapturesBody
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
              {tab === 'Synthetic checks' && <SyntheticsBody slug={fn.id} />}
              {tab === 'Mirrors' && <MirrorsBody slug={fn.id} />}
              {tab === 'Tenant surfaces' && <TenantSurfacesBody slug={fn.id} />}
              {tab === 'TCP listeners' && <TcpListeners slug={fn.id} />}
              {tab === 'UDP listeners' && <UdpListeners slug={fn.id} />}
              {tab === 'OpenAPI' && <OpenAPIBody slug={fn.id} />}
              {tab === 'Consumers' && <ApiConsumers slug={fn.id} />}
              {tab === 'Consumer plans' && <ApiConsumerPlans slug={fn.id} />}

              {tab === 'General' && <AppConfiguration slug={fn.id} section="general" />}
              {tab === 'Runtime' && (
                <>
                  <AppConfiguration slug={fn.id} section="runtime" />
                  <PrewarmPanel slug={fn.id} />
                  <StatelessContract slug={appSlug} />
                </>
              )}
              {tab === 'Health and releases' && <AppConfiguration slug={fn.id} section="health" />}
              {tab === 'Source and access' && (
                <>
                  <GitHubConnectionPanel slug={fn.id} />
                  <AppConfiguration slug={fn.id} section="source" />
                </>
              )}
            </div>
          </TabCapabilityGate>
        </Swap>
      </section>

      <Sheet
        open={Boolean(search.invoke)}
        onClose={() => void setInvoke(false)}
        title="Invoke"
        size="lg"
      >
        <DeploymentCapability
          slug={fn.id}
          resource="Invoke"
          phase={deploymentPhase}
          error={deploymentError}
          hasRunnable={hasRunnable}
          onRetry={() => void appDeploymentQuery.refetch()}
        >
          <InvokePanel slug={fn.id} />
          <AppRetryDefaults slug={fn.id} />
        </DeploymentCapability>
      </Sheet>
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
