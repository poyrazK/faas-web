import {
  useEnvironmentDiff,
  useEnvironmentState,
  useProjectEnvironment,
  useProjectEnvironments,
  validEnvironment,
} from '@/lib/api/projects';
import { Refresh } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState, Panel } from '../primitives';
import { SegmentedControl } from '../tabs';
import { DisclosureSection } from './disclosure';
import { EnvironmentStateView, liveSentence } from './environment-state';
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
/** More environments than this and the picker is a menu, not a row of segments. */
const SEGMENT_LIMIT = 5;
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
  others,
  onChange,
}: Props & { environment: string; others: string[] }) {
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
  // Compared with production by default, or, in production, with the first
  // other environment; an explicit ?compare= wins.
  const from =
    compare && others.includes(compare)
      ? compare
      : environment !== 'production' && others.includes('production')
        ? 'production'
        : others[0];
  const readiness = readinessSearch ?? {};
  // Someone who arrived with a comparison, a promotion or an approval in the
  // URL came for the release tooling, so it starts open for them.
  const toolingAsked = Boolean(
    compare ||
    readiness.promotion ||
    readiness.approval ||
    readiness.promotionBefore ||
    readiness.promotionStatus
  );
  return (
    <>
      {/* The answer for this environment, then the one thing to do with it. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] text-muted-foreground">
          <span className="text-foreground">
            {environment} {detail.data.protected ? 'is protected.' : 'is not protected.'}
          </span>{' '}
          <span
            className={
              state.data.workloads.length > 0 &&
              state.data.workloads.every((workload) => workload.release.status === 'live')
                ? 'text-brand'
                : undefined
            }
          >
            {liveSentence(state.data.workloads)}
          </span>
        </p>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          disabled={detail.isFetching || state.isFetching}
          onClick={() => {
            void detail.refetch();
            void state.refetch();
          }}
        >
          <Refresh aria-hidden className="h-3.5 w-3.5" />
          Refresh
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
      {from && (
        <Differences
          key={`diff:${accountId}:${slug}:${environment}:${from}`}
          accountId={accountId}
          slug={slug}
          environment={environment}
          from={from}
          choices={others}
          onCompare={(next) => onChange({ environment, compare: next })}
        />
      )}
      <DisclosureSection
        key={`tooling:${toolingAsked}`}
        title="Promotions and verification"
        hint={`Preview promoting another environment into ${environment}, look up past promotions and approvals, and check verification runs.`}
        defaultOpen={toolingAsked}
      >
        {onReadinessSearch && (
          <EnvironmentReadiness
            key={`readiness:${accountId}:${projectId}:${environment}:${compare ?? ''}`}
            identity={{ accountId, projectId, project: slug, target: environment }}
            source={compare}
            previewSource={!compare && from ? environmentName(from) : undefined}
            onPreview={from ? () => onChange({ environment, compare: from }) : undefined}
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
      </DisclosureSection>
    </>
  );
}
/** Two environments compared in words; the select beside the heading changes the other side. */
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
  const segments = items.length > 0 && items.length <= SEGMENT_LIMIT && !invalid;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        {segments ? (
          <SegmentedControl
            label="Environment"
            value={selected ?? ''}
            options={items.map((item) => ({ key: item.slug, label: item.slug }))}
            onChange={(next) =>
              onChange({ environment: next, compare: compare === next ? undefined : compare })
            }
          />
        ) : (
          <label className="flex min-w-40 flex-col gap-1.5 text-xs text-muted-foreground">
            Environment
            <Select
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
            </Select>
          </label>
        )}
        {items.length > 1 && (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            Compare with
            <Select
              aria-label="Compare from"
              className={selectClass}
              value={compare ?? ''}
              disabled={!selected || invalid}
              onChange={(event) =>
                onChange({ environment: selected, compare: event.target.value || undefined })
              }
            >
              <option value="">Nothing</option>
              {invalidComparison && <option value={compare}>{compare} (unavailable)</option>}
              {items
                .filter((item) => item.slug !== selected)
                .map((item) => (
                  <option value={item.slug} key={item.id}>
                    {item.slug}
                  </option>
                ))}
            </Select>
          </label>
        )}
      </div>
      {!items.length && <p className="text-sm text-muted-foreground">No environments</p>}
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
      {selected && !invalid && !invalidComparison && (
        <SelectedEnvironment
          key={`${accountId}:${slug}:${selected}:${compare ?? ''}`}
          {...props}
          environment={selected}
          others={items.filter((item) => item.slug !== selected).map((item) => item.slug)}
        />
      )}
    </>
  );
}
