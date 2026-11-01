import { useState } from 'react';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import {
  ruleAction,
  useEdgeWAFReview,
  useUpdateWAFExclusions,
  type EdgeWAFReviewGroup,
} from '@/lib/api/edge-rules';
import type { EdgeRule } from '@/lib/api/queries';
import { Timestamp } from '@/components/ui/timestamp';

/**
 * The WAF false-positive review (faas ADR-831 amendment 13): the app's sampled
 * kind=waf detections over the last 7 days, clamped to the plan's event window,
 * grouped by edge rule, CRS rule and path and assessed (waf_review.go:28-258).
 * An exclusion is added to the whole rule — the CRS rule stops scoring on
 * every path the rule matches — and recorded as a new rule-set version
 * (waf_review.go:302-361), so the confirmation says so.
 */

const ASSESSMENT: Record<EdgeWAFReviewGroup['assessment'], { label: string; color?: string }> = {
  likely_false_positive: { label: 'likely false positive', color: 'var(--status-warning)' },
  likely_attack: { label: 'likely attack', color: 'var(--status-critical)' },
  review: { label: 'review' },
  excluded: { label: 'excluded', color: 'var(--status-good)' },
};

const ruleLabel = (g: EdgeWAFReviewGroup, rule?: EdgeRule) =>
  rule?.name || g.rule_name || g.rule_id.slice(0, 8);

export function EdgeWAFReview({ slug, rules }: { slug: string; rules: EdgeRule[] }) {
  const q = useEdgeWAFReview(slug, true);
  const update = useUpdateWAFExclusions(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const groups = q.data?.groups ?? [];
  const byId = new Map(rules.filter((r) => r.kind === 'waf').map((r) => [r.id, r]));
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: !groups.length });

  const change = async (g: EdgeWAFReviewGroup, rule: EdgeRule, add: boolean) => {
    const name = ruleLabel(g, rule);
    const ok = add
      ? await confirm({
          title: `Exclude CRS ${g.crs_rule_id} from ${name}?`,
          description: `Requests this rule matches (${rule.match_host}${rule.match_path}) are no longer scored against CRS ${g.crs_rule_id} (${g.category}) on every path the rule covers, not only ${g.path}. A request that trips only that check then reaches the app.${
            g.assessment === 'likely_attack'
              ? ' These detections look like an attack: most came from clients flagged on many paths.'
              : ''
          } Recorded as a new rule-set version, so it can be rolled back.`,
          confirmLabel: 'Exclude',
          destructive: true,
        })
      : await confirm({
          title: `Score CRS ${g.crs_rule_id} again in ${name}?`,
          description: `Requests this rule matches are checked against CRS ${g.crs_rule_id} (${g.category}) again, and ${(ruleAction(rule) as { mode?: string } | undefined)?.mode === 'block' ? 'blocked' : 'flagged'} when it fires.`,
          confirmLabel: 'Score again',
          destructive: false,
        });
    if (!ok) return;
    const key = `${g.rule_id}:${g.crs_rule_id}`;
    setBusy(key);
    try {
      await update.mutateAsync(
        add ? { id: rule.id, add: [g.crs_rule_id] } : { id: rule.id, remove: [g.crs_rule_id] }
      );
      toast({
        kind: 'success',
        title: add ? `CRS ${g.crs_rule_id} excluded` : `CRS ${g.crs_rule_id} scored again`,
      });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not change exclusions',
        error: err,
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="WAF review"
      description={`WAF detections${q.data ? ` since ${new Date(q.data.since).toLocaleDateString()}` : ''}, grouped by rule, CRS check and path. Detections are sampled, so counts are lower bounds.${q.data?.truncated ? ' The window held more than a review reads; the oldest were left out.' : ''}`}
      padded={false}
    >
      {phase !== 'ready' ? (
        <div className="p-5">
          <InlinePhase
            phase={phase}
            error={q.error}
            loadingMessage="Reading detections…"
            emptyMessage="No WAF detections in the window."
            onRetry={() => void q.refetch()}
          />
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {groups.map((g) => {
            const rule = byId.get(g.rule_id);
            const a = ASSESSMENT[g.assessment] ?? { label: g.assessment };
            const key = `${g.rule_id}:${g.crs_rule_id}`;
            return (
              <li
                key={`${key}:${g.path}`}
                role="group"
                aria-label={`CRS ${g.crs_rule_id} on ${g.path}`}
                className="flex flex-col gap-1.5 px-5 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">CRS {g.crs_rule_id}</span>
                  <Pill label={g.category} />
                  <Pill label={a.label} color={a.color} />
                  <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
                    {g.path}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {ruleLabel(g, rule)} · {g.events} events ({g.detected} detected, {g.warned}{' '}
                  warned, {g.blocked} blocked) · {g.clients}{' '}
                  {g.clients === 1 ? 'client' : 'clients'} · last <Timestamp value={g.last_seen} />
                </p>
                <p className="text-xs leading-relaxed">
                  {g.reason.replace(/^./, (c) => c.toUpperCase())}.
                  {g.known_false_positive && g.assessment !== 'likely_false_positive'
                    ? ` Known false positive: ${g.known_false_positive}.`
                    : ''}
                </p>
                {rule && (
                  <div>
                    <button
                      type="button"
                      disabled={busy === key}
                      onClick={() => void change(g, rule, !g.excluded)}
                      aria-label={
                        g.excluded
                          ? `Score CRS ${g.crs_rule_id} again in ${ruleLabel(g, rule)}`
                          : `Exclude CRS ${g.crs_rule_id} from ${ruleLabel(g, rule)}`
                      }
                      className="text-xs text-brand transition-colors hover:text-brand-hover disabled:opacity-50"
                    >
                      {g.excluded ? 'Score again' : 'Exclude'}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
