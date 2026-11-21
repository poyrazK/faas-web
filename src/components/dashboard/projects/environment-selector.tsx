import {
  useEnvironmentDiff,
  useEnvironmentState,
  useProjectEnvironment,
  useProjectEnvironments,
  projectKeys,
  validEnvironment,
} from '@/lib/api/projects';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState, Panel } from '../primitives';
import { EnvironmentCard } from './environment-card';
import { EnvironmentDifferences } from './environment-diff';
import { environmentName } from './environment-words';
import { StageQueueOverview } from './stage-queue-bindings';
import { EnvironmentReadiness, type ReadinessSearch } from './environment-readiness';
import { ProjectVerificationRuns } from './project-verification-runs';
import type { components } from '@/lib/api/schema';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { Select } from '@/components/ui/field';
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
/**
 * What only the selected environment carries: its queue bindings, release
 * readiness and verification runs. Its state reads the same query as its card.
 */
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
  previewFrom,
  onPreview,
}: Props & {
  environment: string;
  previewFrom?: string;
  onPreview?: (from: string) => void;
}) {
  const detail = useProjectEnvironment(accountId, slug, environment);
  const state = useEnvironmentState(accountId, slug, environment);
  const error = detail.error || state.error;
  if (error)
    return (
      <ErrorState
        error={error}
        onRetry={() => {
          void detail.refetch();
          void state.refetch();
        }}
      />
    );
  if (detail.isPending || state.isPending)
    return <LoadingState message="Loading environment details…" />;
  if (
    detail.data?.project_id !== projectId ||
    detail.data?.slug !== environment ||
    state.data?.project_slug !== slug ||
    state.data?.environment !== environment ||
    state.data?.configuration.environment !== environment
  )
    return (
      <p role="alert" className="text-sm text-destructive">
        Environment details do not match this selection.
      </p>
    );
  return (
    <>
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
      {onReadinessSearch && (
        <EnvironmentReadiness
          key={`readiness:${accountId}:${projectId}:${environment}:${compare ?? ''}`}
          identity={{ accountId, projectId, project: slug, target: environment }}
          source={compare}
          previewSource={previewFrom && environmentName(previewFrom)}
          onPreview={previewFrom ? () => onPreview?.(previewFrom) : undefined}
          operation={readinessSearch?.promotion}
          approval={readinessSearch?.approval}
          before={readinessSearch?.promotionBefore}
          status={readinessSearch?.promotionStatus}
          onSearch={onReadinessSearch}
        />
      )}
      <ProjectVerificationRuns
        key={`graph-runs:${accountId}:${slug}:${environment}`}
        accountId={accountId}
        project={slug}
        environment={environment}
      />
    </>
  );
}

/**
 * Two environments compared in words. With no explicit comparison it reads the
 * first other environment against the selected one, for display only: the
 * readiness block's promote source stays the explicit `compare`.
 */
function Differences({
  accountId,
  slug,
  environment,
  from,
  choices,
  onCompare,
}: {
  accountId: string;
  slug: string;
  environment: string;
  from: string;
  choices: string[];
  onCompare: (from: string) => void;
}) {
  const diff = useEnvironmentDiff(accountId, slug, environment, from);
  const control = (
    <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
      Compare with
      <Select
        aria-label="Compare from"
        className={selectClass}
        value={from}
        onChange={(event) => onCompare(event.target.value)}
      >
        {choices.map((choice) => (
          <option key={choice} value={choice}>
            {environmentName(choice)}
          </option>
        ))}
      </Select>
    </label>
  );
  if (diff.error) return <ErrorState error={diff.error} onRetry={() => void diff.refetch()} />;
  if (diff.isPending) return <LoadingState message="Comparing environments…" />;
  if (
    !diff.data ||
    diff.data.project_slug !== slug ||
    diff.data.from_environment !== from ||
    diff.data.to_environment !== environment
  )
    return (
      <p role="alert" className="text-sm text-destructive">
        Comparison details do not match this selection.
      </p>
    );
  return <EnvironmentDifferences data={diff.data} control={control} />;
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

/** Production first, then the rest by name. */
const byStage = (a: { slug: string }, b: { slug: string }) =>
  a.slug === 'production' ? -1 : b.slug === 'production' ? 1 : a.slug.localeCompare(b.slug);

function PersonalProjectEnvironments(props: Props) {
  const { accountId, projectId, slug, environment, compare, onChange } = props;
  const query = useProjectEnvironments(accountId, slug);
  const cache = useQueryClient();
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isPending) return <LoadingState message="Loading environments…" />;
  const items = (query.data ?? [])
    .filter((item) => item.project_id === projectId && validEnvironment(item.slug))
    .sort(byStage);
  const selected = environment ?? items.find((item) => item.slug === 'production')?.slug;
  const invalid =
    environment !== undefined &&
    (!validEnvironment(environment) || !items.some((item) => item.slug === environment));
  const invalidComparison =
    compare !== undefined &&
    (!validEnvironment(compare) ||
      compare === selected ||
      !items.some((item) => item.slug === compare));
  const others = items.filter((item) => item.slug !== selected).map((item) => item.slug);
  const from = compare && !invalidComparison ? compare : others[0];
  const select = (next: string) =>
    onChange({ environment: next, compare: compare === next ? undefined : compare });
  return (
    <>
      <Panel
        title="Environments"
        help="Each environment runs its own copy of the project's apps. Choose one to see its releases and queues below."
        actions={
          items.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void cache.invalidateQueries({
                  queryKey: [...projectKeys.detail(accountId, slug), 'environments'],
                })
              }
            >
              Refresh
            </Button>
          )
        }
      >
        <div className="flex flex-col gap-4 p-4">
          {!items.length ? (
            <p className="text-sm text-muted-foreground">No environments</p>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-4">
              {items.map((item) => (
                <EnvironmentCard
                  key={item.id}
                  accountId={accountId}
                  project={slug}
                  environment={item}
                  selected={item.slug === selected && !invalid}
                  onSelect={() => select(item.slug)}
                />
              ))}
            </div>
          )}
          {invalid && (
            <p role="alert" className="text-sm text-destructive">
              Selected environment is unavailable.
            </p>
          )}
          {invalidComparison && (
            <p role="alert" className="text-sm text-destructive">
              Selected comparison is unavailable.
            </p>
          )}
        </div>
      </Panel>
      {selected && !invalid && from && (
        <Differences
          key={`diff:${accountId}:${slug}:${selected}:${from}`}
          accountId={accountId}
          slug={slug}
          environment={selected}
          from={from}
          choices={others}
          onCompare={(next) => onChange({ environment: selected, compare: next })}
        />
      )}
      {selected && !invalid && !invalidComparison && (
        <SelectedEnvironment
          key={`${accountId}:${slug}:${selected}:${compare ?? ''}`}
          {...props}
          environment={selected}
          previewFrom={compare ? undefined : from}
          onPreview={(next) => onChange({ environment: selected, compare: next })}
        />
      )}
    </>
  );
}
