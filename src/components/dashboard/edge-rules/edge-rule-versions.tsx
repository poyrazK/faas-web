import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import {
  useEdgeRuleVersion,
  useEdgeRuleVersions,
  useEdgeStage,
  useRollbackEdgeRules,
  type EdgeRuleSetVersion,
} from '@/lib/api/edge-rules';
import type { EdgeRule } from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { diffRuleSets, rollbackSummary, type RuleDiff } from '@/lib/edge-rule-diff';
import { formatRelative } from '@/lib/mock-data';
import { summarise } from './kinds';

/**
 * Recorded versions of an app's edge-rule set, and rollback.
 *
 * Every committed change records the whole rule set as a version; the list is
 * the 50 newest, without rule bodies, and the newest 100 are kept (faas
 * openapi listEdgeRuleSetVersions, versions.go:94). apid returns rule sets,
 * not a diff, so a version is shown beside the rules now, paired by rule id —
 * the ids a rollback preserves.
 */
export function EdgeRuleVersions({ slug, rules }: { slug: string; rules: EdgeRule[] }) {
  const stage = useEdgeStage('edge-rule-history');
  const versions = useEdgeRuleVersions(slug);
  const [open, setOpen] = useState<number | null>(null);
  const list = versions.data ?? [];
  const latest = list.find((v) => v.current)?.version ?? list[0]?.version ?? 0;
  const phase = queryPhase({
    error: versions.error,
    loading: versions.isPending,
    isEmpty: !list.length,
  });
  return (
    <Panel
      title="Versions"
      description={`${stage ? `${stage} · ` : ''}Every change to this app's rules records the whole set. Compare a version with the rules now, or roll back to it.`}
      padded={false}
    >
      {phase !== 'ready' ? (
        <div className="p-5">
          <InlinePhase
            phase={phase}
            error={versions.error}
            loadingMessage="Reading versions…"
            emptyMessage="No versions yet. The first change to this app's rules records one."
            onRetry={() => void versions.refetch()}
          />
        </div>
      ) : (
        <ul className="flex max-h-80 flex-col divide-y divide-border overflow-y-auto">
          {list.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
              <span className="font-mono text-sm [font-variant-numeric:tabular-nums]">
                v{v.version}
              </span>
              {v.current && <Pill label="Current" color="var(--status-good)" />}
              <span className="text-xs text-muted-foreground">
                {v.rule_count} {v.rule_count === 1 ? 'rule' : 'rules'}
              </span>
              <span className="text-xs text-muted-foreground" title={v.created_at}>
                {formatRelative(Date.parse(v.created_at))}
              </span>
              <button
                type="button"
                onClick={() => setOpen(v.version)}
                aria-label={`Compare version ${v.version}`}
                className="ml-auto text-xs text-brand transition-colors hover:text-brand-hover"
              >
                Compare
              </button>
            </li>
          ))}
        </ul>
      )}
      {open !== null && (
        <VersionDialog
          key={open}
          slug={slug}
          version={open}
          latest={latest}
          rules={rules}
          onClose={() => setOpen(null)}
          onStale={() => void versions.refetch()}
        />
      )}
    </Panel>
  );
}

const CHANGE_LABEL: Record<RuleDiff['change'], string> = {
  changed: 'changes',
  added: 'comes back',
  removed: 'is deleted',
  same: 'unchanged',
};

function VersionDialog({
  slug,
  version,
  latest,
  rules,
  onClose,
  onStale,
}: {
  slug: string;
  version: number;
  latest: number;
  rules: EdgeRule[];
  onClose: () => void;
  onStale: () => void;
}) {
  const detail = useEdgeRuleVersion(slug, version);
  const rollback = useRollbackEdgeRules(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [problem, setProblem] = useState<unknown>(null);
  const diff = useMemo(
    () => (detail.data ? diffRuleSets(rules, detail.data.rules ?? []) : []),
    [detail.data, rules]
  );
  const shown = diff.filter((d) => d.change !== 'same');
  const unchanged = diff.length - shown.length;
  const summary = rollbackSummary(diff);
  const isCurrent = detail.data?.current || version === latest;

  const restore = async (v: EdgeRuleSetVersion) => {
    if (
      !(await confirm({
        title: `Roll back to version ${v.version}?`,
        description: `${summary} Live traffic is handled by version ${v.version}'s rules as soon as the gateways have them. The rollback is recorded as version ${latest + 1}, so it can be undone the same way.`,
        confirmLabel: 'Roll back',
        destructive: true,
      }))
    )
      return;
    setProblem(null);
    try {
      await rollback.mutateAsync({ version: v.version, current: latest });
      toast({ kind: 'success', title: `Rolled back to version ${v.version}` });
      onClose();
    } catch (err) {
      setProblem(err);
      if (err instanceof ApiError && err.code === 'edge_rules_version_mismatch') onStale();
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Version ${version}`}
      description={
        detail.data
          ? `Recorded ${new Date(detail.data.created_at).toLocaleString()}. Compared with the rules now.`
          : undefined
      }
      width="max-w-4xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          {detail.data && !isCurrent && (
            <Button
              size="sm"
              disabled={rollback.isPending || !shown.length}
              onClick={() => void restore(detail.data!)}
            >
              {rollback.isPending ? 'Rolling back…' : `Roll back to version ${version}`}
            </Button>
          )}
        </>
      }
    >
      {!detail.data ? (
        <InlinePhase
          phase={queryPhase({ error: detail.error, loading: detail.isPending })}
          error={detail.error}
          loadingMessage="Reading the version…"
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm">{summary}</p>
          {problem != null && (
            <p role="alert" className="text-xs text-[color:var(--status-critical)]">
              {problem instanceof ApiError && problem.code === 'edge_rules_version_mismatch'
                ? 'The rules changed since this page read them, so nothing was rolled back. Compare again with the rules as they are now.'
                : errorMessage(problem)}
            </p>
          )}
          {shown.map((d) => (
            <section
              key={d.id}
              role="group"
              aria-label={`Rule ${d.id}: ${CHANGE_LABEL[d.change]}`}
              className="rounded-lg border border-border"
            >
              <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
                <span className="font-mono">{(d.after ?? d.before)?.name || d.id.slice(0, 8)}</span>
                <Pill
                  label={CHANGE_LABEL[d.change]}
                  color={
                    d.change === 'removed'
                      ? 'var(--status-critical)'
                      : d.change === 'added'
                        ? 'var(--status-good)'
                        : 'var(--status-warning)'
                  }
                />
                {d.change === 'changed' && (
                  <span className="text-muted-foreground">Changes: {d.fields.join(', ')}</span>
                )}
              </header>
              <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <RuleCell heading="Now" rule={d.before} empty="Not in the rules now" />
                <RuleCell
                  heading={`Version ${version}`}
                  rule={d.after}
                  empty="Deleted by the rollback"
                />
              </div>
            </section>
          ))}
          {unchanged > 0 && (
            <p className="text-xs text-muted-foreground">
              {unchanged} {unchanged === 1 ? 'rule is' : 'rules are'} the same in both.
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}

function RuleCell({ heading, rule, empty }: { heading: string; rule?: EdgeRule; empty: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-3 py-2.5 text-xs">
      <span className="label-mono text-muted-foreground">{heading}</span>
      {!rule ? (
        <span className="text-muted-foreground">{empty}</span>
      ) : (
        <>
          <span className="flex flex-wrap items-center gap-2">
            <Pill label={rule.kind} />
            <span className="font-mono [font-variant-numeric:tabular-nums]">#{rule.priority}</span>
            {!rule.enabled && <span className="text-muted-foreground">paused</span>}
            {rule.mode === 'log' && <span className="text-muted-foreground">log mode</span>}
            {rule.penalty && (
              <span className="text-muted-foreground">penalty {rule.penalty.seconds} s</span>
            )}
          </span>
          <span className="truncate font-mono">
            {rule.match_host}
            {rule.match_path} · {rule.match_methods?.length ? rule.match_methods.join(', ') : 'ANY'}
          </span>
          <span className="break-words font-mono">{summarise(rule.kind, rule.action)}</span>
          {rule.match && (
            <span className="break-words font-mono text-muted-foreground">
              when {describeMatch(rule.match)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A rule's match condition in one line (faas ADR-962): the condition, not the
 * action, decides what a recipe's deny-all rule blocks.
 */
function describeMatch(m: NonNullable<EdgeRule['match']>): string {
  if (m.all?.length) return m.all.map(describeMatch).join(' and ');
  if (m.any?.length) return m.any.map((x) => `(${describeMatch(x)})`).join(' or ');
  if (m.not) return `not (${describeMatch(m.not)})`;
  const op = (m.op ?? '').replace('in_list', 'in list').replace('_', ' ');
  const value = m.list ?? m.values?.join(', ') ?? m.value ?? '';
  return [m.field, op, value].filter(Boolean).join(' ');
}
