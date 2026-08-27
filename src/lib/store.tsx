import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  keys,
  useApps,
  useAppsMetrics,
  useCreateApp,
  useDeployments,
  useRollback,
  type Deployment as ApiDeployment,
  type MetricsRange,
} from './api/queries';
import { slugIndex, toDeployment, toWorkflow } from './api/adapters';
import { isDeploymentTerminal } from './deployment-status';
import { NOW, type Deployment, type Runtime, type Workflow } from './mock-data';

/**
 * The workspace, backed by the real API.
 *
 * This was an in-memory fixture store. It now reads `/v1/apps`,
 * `/v1/apps/metrics`, and `/v1/deployments` through TanStack Query and projects
 * them onto the view models the console already renders (see `api/adapters.ts`).
 *
 * The hook surface is deliberately close to what it replaced, so the pages that
 * consume it kept working — but two things genuinely changed and callers have to
 * deal with them:
 *
 * - **`loading` and `error` are real.** There is a network in the way now.
 * - **`addWorkflow` and `redeploy` are async and can fail.** They were
 *   fire-and-forget against local state; they are HTTP writes now, and the
 *   caller has to await them and show what happened.
 */

export interface NewWorkflowInput {
  name: string;
  runtime: Runtime;
  memoryMb: number;
  /** `function` runs a runtime; `app` runs a container image. */
  type?: 'app' | 'function';
}

interface DataValue {
  workflows: Workflow[];
  deployments: Deployment[];
  loading: boolean;
  error: Error | null;
  getWorkflow: (id: string) => Workflow | undefined;
  deploymentsFor: (id: string) => Deployment[];
  workflowsForProject: (projectId: string) => Workflow[];
  addWorkflow: (input: NewWorkflowInput) => Promise<Workflow>;
  /** Rolls the app back to its previous deployment. */
  redeploy: (id: string) => Promise<void>;
  /** Refetches apps, metrics, and deployments. */
  refresh: () => void;
}

const DataContext = createContext<DataValue | null>(null);

/** Matches the console's default dashboard window. */
const DEFAULT_RANGE: MetricsRange = '24h';

export function DataProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const appsQuery = useApps();
  const deploymentsQuery = useDeployments(50, {
    // A deployment is the durable source of truth for both the app page and
    // the global history. Keep the list current while a build is moving, then
    // stop polling once every visible row has reached a terminal state.
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      return items.some((deployment) => !isDeploymentTerminal(deployment.status)) ? 2_500 : false;
    },
  });
  // Metrics are a separate query on purpose: a degraded Prometheus zeroes this
  // response without taking the app list down with it, and the list is what the
  // console is actually for.
  const metricsQuery = useAppsMetrics(DEFAULT_RANGE);

  const createApp = useCreateApp();
  const rollback = useRollback();

  const apps = useMemo(() => appsQuery.data ?? [], [appsQuery.data]);

  // The list arrives newest-first, so the first hit per app is its latest —
  // which is where a workflow's version and deploy time come from.
  const latestByAppId = useMemo(() => {
    const byApp = new Map<string, ApiDeployment>();
    for (const d of deploymentsQuery.data?.items ?? []) {
      if (!byApp.has(d.app_id)) byApp.set(d.app_id, d);
    }
    return byApp;
  }, [deploymentsQuery.data]);

  const workflows = useMemo(
    () => apps.map((app) => toWorkflow(app, metricsQuery.data, latestByAppId.get(app.id))),
    [apps, metricsQuery.data, latestByAppId]
  );

  const deployments = useMemo(() => {
    const bySlug = slugIndex(apps);
    return (deploymentsQuery.data?.items ?? []).map((d) => toDeployment(d, bySlug));
  }, [apps, deploymentsQuery.data]);

  const value = useMemo<DataValue>(
    () => ({
      workflows,
      deployments,
      // Metrics are excluded: the list should paint as soon as the apps land
      // rather than waiting on a Prometheus round-trip that may be degraded.
      loading: appsQuery.isPending || deploymentsQuery.isPending,
      error: appsQuery.error ?? deploymentsQuery.error ?? null,
      getWorkflow: (id) => workflows.find((f) => f.id === id),
      deploymentsFor: (id) => deployments.filter((d) => d.workflowId === id),
      workflowsForProject: (projectId) => workflows.filter((f) => f.projectId === projectId),

      addWorkflow: async (input) => {
        const app = await createApp.mutateAsync({
          slug: input.name,
          type: input.type ?? 'function',
          runtime: input.runtime,
          ram_mb: input.memoryMb,
        });
        return toWorkflow(app);
      },

      // The console's "redeploy" is a rollback to the previous deployment.
      // Creating a *new* deployment needs an image or a source ref, which is
      // the CLI's and GitHub integration's job, not a button in a dashboard.
      redeploy: async (id) => {
        await rollback.mutateAsync(id);
      },

      refresh: () => {
        void qc.invalidateQueries({ queryKey: keys.apps });
        void qc.invalidateQueries({ queryKey: keys.deployments });
      },
    }),
    [
      workflows,
      deployments,
      appsQuery.isPending,
      appsQuery.error,
      deploymentsQuery.isPending,
      deploymentsQuery.error,
      createApp,
      rollback,
      qc,
    ]
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}

export { NOW };
