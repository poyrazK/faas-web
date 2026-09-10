import { useState } from 'react';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  LoadingState,
  Panel,
  RangeSelector,
  StatTile,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useCreateMirrorRule,
  useDeleteMirrorRule,
  useAppDeployments,
  useMirrorRules,
  useMirrorSummary,
  useUpdateMirrorRule,
  type Deployment,
  type MirrorRule,
  type MirrorWindow,
} from '@/lib/api/queries';
import { cn } from '@/lib/utils';

/**
 * Traffic mirroring (ADR-124 / ADR-125): a share of a live deployment's
 * requests is replayed against a second deployment of the same app, and the
 * comparison ledger counts what came back differently.
 *
 * The summary's latency deltas are signed. Positive means the mirror answered
 * slower than the source, so the sign is the finding and the magnitude is
 * its size — the number is rendered as a direction, never an absolute.
 *
 * The plan gate (`403 plan_mirror_not_allowed`, Pro/Scale only) fires on
 * create, not on list, so the empty list is still honest on Free and Hobby;
 * the gate is explained where it lands. Every other refusal has a code the
 * API documents, and each gets its own sentence.
 */

const WINDOWS: { key: MirrorWindow; label: string }[] = [
  { key: '1h', label: '1h' },
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
];

/** "mirror 12 ms slower" / "mirror 8 ms faster" / "no difference". */
export function latencyDirection(diffMs: number): string {
  const rounded = Math.round(Math.abs(diffMs));
  if (rounded === 0) return 'no difference';
  return `mirror ${rounded} ms ${diffMs > 0 ? 'slower' : 'faster'}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function explainMirrorError(err: unknown): {
  kind: 'info' | 'error';
  title: string;
  description?: string;
} {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'plan_mirror_not_allowed':
        return {
          kind: 'info',
          title: 'Not on your plan',
          description: 'Traffic mirroring needs the Pro or Scale plan.',
        };
      case 'mirror_rule_quota_exceeded':
        return {
          kind: 'info',
          title: 'Mirror limit reached',
          description:
            'Your plan allows no more mirror rules on this app. Remove one to add another.',
        };
      case 'mirror_deployment_not_live':
        return {
          kind: 'error',
          title: 'Both deployments must be live',
          description: 'A mirror binds two live deployments of the same app.',
        };
      case 'mirror_source_target_same':
        return { kind: 'error', title: 'Pick two different deployments' };
      case 'mirror_cross_app_mismatch':
        return { kind: 'error', title: 'Both deployments must belong to this app' };
      case 'invalid_mirror_percent':
        return { kind: 'error', title: 'Percent must be between 0 and 100' };
    }
  }
  return { kind: 'error', title: 'Could not save the mirror rule', description: errorMessage(err) };
}

export function MirrorRules({ slug }: { slug: string }) {
  const rules = useMirrorRules(slug);
  const deployments = useAppDeployments(slug);
  const appDeployments: Deployment[] = deployments.data?.pages.flatMap((page) => page.items) ?? [];
  // The create form's "there are none right now" is a claim about the app's
  // deployments, so it must not be made while those queries are still out.
  const readError = rules.error ?? (appDeployments.length === 0 ? deployments.error : undefined);
  const phase = queryPhase({
    error: readError,
    loading: rules.isPending || deployments.isPending,
  });
  const byId = new Map(appDeployments.map((d) => [d.id, d]));
  const retry = () => {
    if (rules.error) void rules.refetch();
    if (deployments.error) void deployments.refetch();
  };

  return (
    <Panel
      title="Mirror rules"
      description="Replay a share of a live deployment's requests against another deployment and count the differences."
    >
      {phase === 'unreachable' ? (
        <UnreachableState onRetry={retry} />
      ) : phase === 'loading' ? (
        <LoadingState message="Loading mirror rules…" />
      ) : phase === 'error' ? (
        <ErrorState error={readError} onRetry={retry} />
      ) : (
        <div className="flex flex-col gap-6">
          {(rules.data?.rules.length ?? 0) === 0 ? (
            <EmptyState message="No mirror rules yet. Bind a live deployment to a second one below." />
          ) : (
            <ul className="flex flex-col gap-4">
              {rules.data?.rules.map((rule) => (
                <li key={rule.id}>
                  <MirrorRuleCard rule={rule} slug={slug} deployments={byId} />
                </li>
              ))}
            </ul>
          )}
          <CreateMirrorRule slug={slug} deployments={appDeployments} />
          {deployments.hasNextPage && (
            <div className="flex flex-col items-center gap-2">
              <Button
                size="xs"
                variant="outline"
                busy={deployments.isFetchingNextPage}
                onClick={() => void deployments.fetchNextPage().catch(() => undefined)}
              >
                Load older deployments
              </Button>
              {Boolean(deployments.error) && (
                <InlinePhase
                  phase={queryPhase({ error: deployments.error })}
                  error={deployments.error}
                />
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function MirrorRuleCard({
  rule,
  slug,
  deployments,
}: {
  rule: MirrorRule;
  slug: string;
  deployments: Map<string, Deployment>;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const update = useUpdateMirrorRule(slug);
  const remove = useDeleteMirrorRule(slug);

  const onToggle = (enabled: boolean) => {
    void update
      .mutateAsync({ id: rule.id, enabled })
      .catch((err: unknown) => toast(explainMirrorError(err)));
  };

  const onDelete = async () => {
    if (
      !(await confirm({
        title: 'Delete this mirror rule?',
        description: 'Mirrored traffic stops and the comparison ledger for this rule is discarded.',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(rule.id);
      toast({ kind: 'success', title: 'Mirror rule deleted' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not_found') {
        toast({
          kind: 'info',
          title: 'Already gone',
          description: 'This rule was deleted elsewhere.',
        });
        return;
      }
      toast(explainMirrorError(err));
    }
  };

  const endpoint = (id: string, label: string) => {
    const d = deployments.get(id);
    return (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="label-mono text-muted-foreground">{label}</span>
        <span className="flex items-center gap-2 font-mono text-xs">
          <span title={id}>{shortId(id)}</span>
          {d && (
            <Pill
              label={d.status}
              color={d.status === 'live' ? 'var(--status-good)' : 'var(--status-idle)'}
            />
          )}
        </span>
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start gap-6">
        {endpoint(rule.source_deployment_id, 'Source')}
        {endpoint(rule.mirror_deployment_id, 'Mirror')}
        <span className="flex flex-col gap-0.5">
          <span className="label-mono text-muted-foreground">Share</span>
          <span className="text-sm [font-variant-numeric:tabular-nums]">{rule.percent}%</span>
        </span>
        <span className="flex flex-col gap-0.5">
          <span className="label-mono text-muted-foreground">Bodies</span>
          <span className="text-sm">{rule.include_body ? 'compared' : 'headers only'}</span>
        </span>
        {rule.redact_headers.length > 0 && (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="label-mono text-muted-foreground">Redacted</span>
            <span className="truncate font-mono text-xs">{rule.redact_headers.join(', ')}</span>
          </span>
        )}
        <span className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {rule.enabled ? 'Enabled' : 'Disabled'}
            <Switch
              checked={rule.enabled}
              onCheckedChange={onToggle}
              aria-label={`Mirror rule ${shortId(rule.id)} enabled`}
              disabled={update.isPending}
              className="data-[state=checked]:bg-brand"
            />
          </label>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void onDelete()}
            disabled={remove.isPending}
            aria-label={`Delete mirror rule ${shortId(rule.id)}`}
          >
            <Trash className="h-3.5 w-3.5" />
            Delete
          </Button>
        </span>
      </div>
      <MirrorSummary slug={slug} id={rule.id} />
    </div>
  );
}

export function MirrorSummary({ slug, id }: { slug: string; id: string }) {
  const [window, setWindow] = useState<MirrorWindow>('1h');
  const summary = useMirrorSummary(slug, id, window);
  const data = summary.data;
  const state = summary.isPending ? 'loading' : summary.error ? 'unavailable' : 'ready';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="label-mono text-muted-foreground">Drift over the last {window}</p>
        <RangeSelector value={window} options={WINDOWS} onChange={setWindow} />
      </div>
      {summary.error ? (
        <p className="text-sm text-muted-foreground">{errorMessage(summary.error)}</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile label="Mirrored" value={data?.total_invocations} state={state} />
            <StatTile
              label="Status diffs"
              value={data?.status_diff_count}
              state={state}
              tone="orange"
            />
            <StatTile
              label="Schema diffs"
              value={data?.schema_diff_count}
              state={state}
              tone="orange"
            />
            <StatTile
              label="Body diffs"
              value={data?.body_diff_count}
              state={state}
              tone="orange"
            />
            <StatTile label="Crashes" value={data?.crash_count} state={state} tone="red" />
          </div>
          {data && (
            <p className="text-sm text-muted-foreground">
              Latency:{' '}
              <span className="text-foreground">{latencyDirection(data.mean_latency_diff_ms)}</span>{' '}
              on average, {latencyDirection(data.p99_latency_diff_ms)} at p99
              {data.total_invocations === 0 ? ' — nothing mirrored in this window yet.' : '.'}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function CreateMirrorRule({ slug, deployments }: { slug: string; deployments: Deployment[] }) {
  const { toast } = useToast();
  const create = useCreateMirrorRule(slug);
  const live = deployments.filter((d) => d.status === 'live');
  const [source, setSource] = useState('');
  const [mirror, setMirror] = useState('');
  const [percent, setPercent] = useState('100');
  const [includeBody, setIncludeBody] = useState(false);
  const [redact, setRedact] = useState('');

  const percentValue = Number(percent);
  // `Number('')` is 0, so an emptied field would otherwise pass as a legal 0%
  // rule — one the API accepts and that never fires.
  const percentOk = /^\d+$/.test(percent.trim()) && percentValue >= 0 && percentValue <= 100;
  const sourceId = source || live[0]?.id || '';
  const mirrorId = mirror || live.find((d) => d.id !== sourceId)?.id || '';
  const ready = Boolean(sourceId && mirrorId && sourceId !== mirrorId && percentOk);

  const submit = async () => {
    try {
      await create.mutateAsync({
        source_deployment_id: sourceId,
        mirror_deployment_id: mirrorId,
        percent: percentValue,
        include_body: includeBody,
        redact_headers: redact
          .split(',')
          .map((h) => h.trim())
          .filter(Boolean),
      });
      toast({
        kind: 'success',
        title: 'Mirror rule created',
        description: `${percentValue}% of ${shortId(sourceId)}'s traffic is mirrored to ${shortId(mirrorId)}.`,
      });
      setRedact('');
    } catch (err) {
      toast(explainMirrorError(err));
    }
  };

  if (live.length < 2) {
    return (
      <p className="text-sm text-muted-foreground">
        A mirror binds two live deployments of this app; there{' '}
        {live.length === 1 ? 'is one' : 'are none'} right now.
      </p>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !create.isPending) void submit();
      }}
    >
      <p className="label-mono text-muted-foreground">New mirror rule</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Source</span>
          <Select value={sourceId} onChange={(e) => setSource(e.target.value)}>
            {live.map((d) => (
              <option key={d.id} value={d.id}>
                {shortId(d.id)} · {d.kind}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Mirror</span>
          <Select value={mirrorId} onChange={(e) => setMirror(e.target.value)}>
            {live.map((d) => (
              <option key={d.id} value={d.id}>
                {shortId(d.id)} · {d.kind}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex w-24 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Share %</span>
          <input
            type="number"
            min={0}
            max={100}
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            aria-invalid={!percentOk || undefined}
            aria-describedby={!percentOk ? 'mirror-percent-error' : undefined}
            className={cn(FIELD, 'w-full')}
          />
        </label>
        <label className="flex min-w-56 flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Redact headers (comma-separated)</span>
          <input
            value={redact}
            onChange={(e) => setRedact(e.target.value)}
            placeholder="X-Tenant-Id, Authorization"
            className={cn(FIELD, 'w-full')}
          />
        </label>
        <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={includeBody}
            onCheckedChange={setIncludeBody}
            aria-label="Compare response bodies"
            className="data-[state=checked]:bg-brand"
          />
          Compare bodies
        </label>
        <Button
          type="submit"
          size="sm"
          className="gap-1.5"
          disabled={!ready}
          busy={create.isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          Add mirror
        </Button>
      </div>
      {!percentOk && (
        <FieldError id="mirror-percent-error">A whole number between 0 and 100.</FieldError>
      )}
      {sourceId === mirrorId && (
        <p className="text-xs text-muted-foreground">
          Source and mirror must be different deployments.
        </p>
      )}
    </form>
  );
}
