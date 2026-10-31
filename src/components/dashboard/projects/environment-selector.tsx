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
import type { components } from '@/lib/api/schema';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
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
}: Props & { environment: string }) {
  const detail = useProjectEnvironment(accountId, slug, environment);
  const state = useEnvironmentState(accountId, slug, environment);
  const diff = useEnvironmentDiff(accountId, slug, environment, compare ?? '');
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
      {environment !== 'production' && (
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
      {onReadinessSearch && (
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
    </>
  );
}
/**
 * Environment routes resolve the project under the signed-in account
 * (faas ProjectBySlug(acct.ID, slug)), so in a company workspace they would
 * read a same-named personal project. Company environments are preview (A20,
 * Wave 3); until then the panel says so and reads nothing.
 */
export function ProjectEnvironments(props: Props) {
  const { org, label } = useWorkspaceTarget();
  if (org)
    return (
      <Panel title="Environments">
        <p role="status" className="text-sm text-muted-foreground">
          Environments for {label}'s projects are not available in the console yet.
        </p>
      </Panel>
    );
  return <PersonalProjectEnvironments {...props} />;
}

function PersonalProjectEnvironments(props: Props) {
  const { accountId, projectId, slug, environment, compare, onChange } = props;
  const query = useProjectEnvironments(accountId, slug);
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
