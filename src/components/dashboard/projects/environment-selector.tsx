import {
  useEnvironmentDiff,
  useEnvironmentState,
  useProjectEnvironment,
  useProjectEnvironments,
  validEnvironment,
} from '@/lib/api/projects';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState, Panel } from '../primitives';
import { EnvironmentStateView } from './environment-state';
import { EnvironmentDiffView } from './environment-diff';
import { StageQueueOverview } from './stage-queue-bindings';
import { EnvironmentReadiness, type ReadinessSearch } from './environment-readiness';
import { ProjectVerificationRuns } from './project-verification-runs';
import type { components } from '@/lib/api/schema';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { CapabilityGate } from '../capability-gate';
import {
  EnvironmentConfigEditor,
  EnvironmentManager,
  EnvironmentSecrets,
} from './environment-manager';
const selectClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';
type Props = {
  accountId: string;
  plan: components['schemas']['CapabilitiesResponse']['plan'];
  projectId: string;
  slug: string;
  environment?: string;
  compare?: string;
  queueWorkload?: string;
  onChange: (next: { environment?: string; compare?: string }) => void;
  onSelectQueueWorkload: (slug?: string) => void;
  readinessSearch?: ReadinessSearch;
  onReadinessSearch?: (patch: ReadinessSearch) => void;
};
/** The company organization a company project's environments are read under; null when personal. */
type Scoped = Props & { org: string | null; label: string };
function SelectedEnvironment({
  accountId,
  plan,
  projectId,
  slug,
  environment,
  compare,
  queueWorkload,
  onSelectQueueWorkload,
  readinessSearch,
  onReadinessSearch,
  org,
  label,
}: Scoped & { environment: string }) {
  const detail = useProjectEnvironment(accountId, slug, environment, org);
  const state = useEnvironmentState(accountId, slug, environment, org);
  const diff = useEnvironmentDiff(accountId, slug, environment, compare ?? '', org);
  const scope = { accountId, slug, org };
  const error = detail.error || state.error || (compare ? diff.error : null);
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void detail.refetch();
          void state.refetch();
          if (compare) void diff.refetch();
        }}
      />
    );
  if (detail.isPending || state.isPending || (compare && diff.isPending))
    return <LoadingState message="Loading environment evidence…" />;
  if (
    detail.data?.project_id !== projectId ||
    detail.data?.slug !== environment ||
    state.data?.project_slug !== slug ||
    state.data?.environment !== environment ||
    state.data?.configuration.environment !== environment ||
    (compare &&
      (diff.data?.project_slug !== slug ||
        diff.data?.from_environment !== compare ||
        diff.data?.to_environment !== environment))
  )
    return (
      <p role="alert" className="text-sm text-destructive">
        Environment evidence does not match this selection.
      </p>
    );
  return (
    <>
      <div className="flex items-center justify-between gap-3 text-sm">
        <p>
          {environment}
          {detail.data.protected ? ' · Protected' : ''}
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={detail.isFetching || state.isFetching || diff.isFetching}
          onClick={() => {
            void detail.refetch();
            void state.refetch();
            if (compare) void diff.refetch();
          }}
        >
          Refresh environment
        </Button>
      </div>
      <EnvironmentStateView data={state.data} />
      <EnvironmentConfigEditor
        key={`config:${environment}`}
        scope={scope}
        environment={environment}
      />
      {org ? (
        <Panel title="Not in the console for company projects yet">
          <p role="status" className="text-sm text-muted-foreground">
            The API this console is built from has no shared secrets, promotions, stage queue
            settings or verification runs under {label}&apos;s projects. Manage those with the CLI
            while signed in to {label}.
          </p>
        </Panel>
      ) : (
        <EnvironmentSecrets
          key={`secrets:${environment}`}
          scope={scope}
          environment={environment}
        />
      )}
      {!org && environment !== 'production' && (
        <StageQueueOverview
          key={`${accountId}:${slug}:${environment}`}
          accountId={accountId}
          plan={plan}
          project={slug}
          projectId={projectId}
          environment={environment}
          environmentId={detail.data.id}
          protectedStage={detail.data.protected}
          workloads={state.data.workloads}
          selectedWorkload={queueWorkload}
          onSelectWorkload={onSelectQueueWorkload}
        />
      )}
      {compare && diff.data && <EnvironmentDiffView data={diff.data} />}
      {!org && onReadinessSearch && (
        <EnvironmentReadiness
          key={`readiness:${accountId}:${projectId}:${environment}:${compare ?? ''}`}
          identity={{ accountId, projectId, project: slug, target: environment }}
          source={compare}
          operation={readinessSearch?.promotion}
          approval={readinessSearch?.approval}
          before={readinessSearch?.promotionBefore}
          status={readinessSearch?.promotionStatus}
          onSearch={onReadinessSearch}
        />
      )}
      {!org && (
        <ProjectVerificationRuns
          key={`graph-runs:${accountId}:${slug}:${environment}`}
          accountId={accountId}
          project={slug}
          environment={environment}
        />
      )}
    </>
  );
}
/**
 * Environments are a preview capability (`environments`); nothing is read
 * until the account has it. Environment routes resolve the project under the
 * signed-in account (faas ProjectBySlug(acct.ID, slug)), so a company
 * workspace reads the `/v1/orgs/{organization}/projects…` family instead.
 */
export function ProjectEnvironments(props: Props) {
  return (
    <CapabilityGate capability="environments" title="Environments">
      <ScopedEnvironments {...props} />
    </CapabilityGate>
  );
}

function ScopedEnvironments(props: Props) {
  const { org, label } = useWorkspaceTarget();
  return <ProjectEnvironmentList {...props} org={org} label={label} />;
}

function ProjectEnvironmentList(props: Scoped) {
  const { accountId, projectId, slug, environment, compare, onChange, org, label } = props;
  const query = useProjectEnvironments(accountId, slug, org);
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isPending) return <LoadingState message="Loading environments…" />;
  const items = (query.data ?? []).filter(
    (item) => item.project_id === projectId && validEnvironment(item.slug)
  );
  const selected = environment ?? items.find((item) => item.slug === 'production')?.slug;
  const invalid =
    environment !== undefined &&
    (!validEnvironment(environment) || !items.some((item) => item.slug === environment));
  const invalidComparison =
    compare !== undefined &&
    (!validEnvironment(compare) ||
      compare === selected ||
      !items.some((item) => item.slug === compare));
  return (
    <>
      <Panel
        title="Environments"
        description="Named environment evidence and comparisons. Stage desired queue settings can be reviewed below."
      >
        <div className="flex flex-wrap gap-4 p-4">
          <label className="flex min-w-40 flex-col gap-2 text-sm">
            Environment
            <select
              aria-label="Environment"
              className={selectClass}
              value={selected ?? ''}
              onChange={(event) =>
                onChange({
                  environment: event.target.value || undefined,
                  compare: compare === event.target.value ? undefined : compare,
                })
              }
            >
              <option value="">Select an environment</option>
              {invalid && <option value={environment}>{environment} (unavailable)</option>}
              {items.map((item) => (
                <option value={item.slug} key={item.id}>
                  {item.slug}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-40 flex-col gap-2 text-sm">
            Compare from
            <select
              aria-label="Compare from"
              className={selectClass}
              value={compare ?? ''}
              disabled={!selected || invalid}
              onChange={(event) =>
                onChange({ environment: selected, compare: event.target.value || undefined })
              }
            >
              <option value="">No comparison</option>
              {invalidComparison && <option value={compare}>{compare} (unavailable)</option>}
              {items
                .filter((item) => item.slug !== selected)
                .map((item) => (
                  <option value={item.slug} key={item.id}>
                    {item.slug}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {!items.length && (
          <p className="px-4 pb-4 text-sm text-muted-foreground">No environments</p>
        )}
        {invalid && (
          <p role="alert" className="px-4 pb-4 text-sm text-destructive">
            Selected environment is unavailable.
          </p>
        )}
        {invalidComparison && (
          <p role="alert" className="px-4 pb-4 text-sm text-destructive">
            Selected comparison is unavailable.
          </p>
        )}
      </Panel>
      <EnvironmentManager
        scope={{ accountId, slug, org }}
        items={items}
        label={label}
        onCreated={(created) => onChange({ environment: created, compare: undefined })}
      />
      {selected && !invalid && !invalidComparison && (
        <SelectedEnvironment
          key={`${accountId}:${slug}:${selected}:${compare ?? ''}`}
          {...props}
          environment={selected}
        />
      )}
    </>
  );
}
