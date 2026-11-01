import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { Modal } from '@/components/ui/modal';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import {
  useAlertRule,
  useNotificationChannels,
  type AlertRule,
} from '@/lib/api/notification-channels';
import { useUpdateAlert } from '@/lib/api/queries';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { COMPARISON_LABEL, MAX_CHANNELS_PER_RULE, metricSpec } from '@/lib/alert-rules';
import { AlertDeliveries } from './alert-deliveries';
import { InlinePhase, queryPhase } from './primitives';
import { Pill } from './resource-table';

const STATE_COLOR: Record<string, string> = {
  ok: 'var(--status-good)',
  firing: 'var(--status-critical)',
  degraded: 'var(--status-warning)',
  unknown: 'var(--muted-foreground)',
};

/** The API's own meanings for the evaluation states (AlertRuleResponse.state). */
const STATE_MEANING: Record<string, string> = {
  ok: 'Within its threshold at the last evaluation.',
  firing: 'Past its threshold; it notifies again after the cooldown.',
  degraded: "The rule's metric source was unavailable at the last evaluation.",
  unknown:
    'Not enough data to decide: too few samples, compacted history, or a paused consumer. It neither fires nor clears.',
};

/**
 * One rule in full: its evaluation state, when it last fired and was
 * evaluated, what it watches, where it delivers, and its delivery history.
 * Channels can be changed here; the rest of a rule is edited by recreating it,
 * as the API refuses metric-family changes.
 */
export function AlertDetailDrawer({
  slug,
  ruleId,
  onClose,
}: {
  slug: string;
  ruleId: string | undefined;
  onClose: () => void;
}) {
  return (
    <Modal
      open={Boolean(ruleId)}
      onClose={onClose}
      title="Alert rule"
      description={`App ${slug}`}
      placement="right"
    >
      {ruleId ? <RuleDetail slug={slug} ruleId={ruleId} /> : null}
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-baseline gap-3 py-1.5 text-sm">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function RuleDetail({ slug, ruleId }: { slug: string; ruleId: string }) {
  const rule = useAlertRule(slug, ruleId);
  const phase = queryPhase({ loading: rule.isPending, error: rule.error });
  if (phase !== 'ready' || !rule.data)
    return <InlinePhase phase={phase} error={rule.error} onRetry={() => void rule.refetch()} />;
  const r = rule.data;
  const metric = metricSpec(r.metric)?.label;
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-medium">{r.name}</h3>
          <Pill label={r.state} color={STATE_COLOR[r.state]} />
          {!r.enabled && <Pill label="paused" />}
        </div>
        <p className="text-xs text-muted-foreground">{STATE_MEANING[r.state]}</p>
      </section>

      <dl className="flex flex-col divide-y divide-border">
        <Row label="Last fired">
          {r.last_fired_at ? <Timestamp value={r.last_fired_at} /> : 'Never'}
        </Row>
        <Row label="Last evaluated">
          {r.last_evaluated_at ? <Timestamp value={r.last_evaluated_at} /> : 'Not yet'}
        </Row>
        <Row label="Condition">
          <span className="font-mono text-xs">
            {r.metric} {COMPARISON_LABEL[r.comparison] ?? r.comparison} {r.threshold}
          </span>
          {metric && <span className="ml-2 text-xs text-muted-foreground">{metric}</span>}
        </Row>
        <Row label="Window">
          <span className="font-mono text-xs">{r.window_spec}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            cooldown {r.cooldown_minutes} min
          </span>
        </Row>
        {r.failure_source && (
          <Row label="Failure source">
            <span className="font-mono text-xs">{r.failure_source}</span>
          </Row>
        )}
        {r.slo_id && (
          <Row label="SLO">
            <CopyableId value={r.slo_id} label="SLO ID" />
          </Row>
        )}
        {r.synthetic_check_id && (
          <Row label="Synthetic check">
            <CopyableId value={r.synthetic_check_id} label="synthetic check ID" />
          </Row>
        )}
        {r.log_query && (
          <Row label="Log query">
            <code className="break-all font-mono text-xs">{r.log_query}</code>
          </Row>
        )}
        {r.custom_metric_name && (
          <Row label="Custom metric">
            <span className="font-mono text-xs">{r.custom_metric_name}</span>
          </Row>
        )}
        <Row label="Action">
          <span className="font-mono text-xs">{r.action}</span>
        </Row>
        <Row label="Webhook">
          {r.webhook_url ? (
            <span className="block truncate font-mono text-xs" title={r.webhook_url}>
              {r.webhook_url.replace(/^https?:\/\//, '')}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">None; channels only</span>
          )}
        </Row>
        <Row label="Rule ID">
          <CopyableId value={r.id} label="alert rule ID" />
        </Row>
        <Row label="Created">
          <Timestamp value={r.created_at} />
        </Row>
      </dl>

      <RuleChannels slug={slug} rule={r} />

      <section className="flex flex-col gap-2">
        <h3 className="label-mono text-foreground">Webhook deliveries</h3>
        <AlertDeliveries slug={slug} ruleId={r.id} />
      </section>
    </div>
  );
}

/**
 * The rule's channels. Bindings are the signed-in account's own channels, so
 * a company workspace sees only how many there are (ADR-20261026151103).
 */
function RuleChannels({ slug, rule }: { slug: string; rule: AlertRule }) {
  const { org } = useWorkspaceTarget();
  const { access } = useCapabilityAccess('notification-channels');
  const editable = !org && access === 'on';
  const channels = useNotificationChannels(editable);
  const bound = rule.channel_ids ?? [];
  const n = bound.length;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="label-mono text-foreground">Notification channels</h3>
      {!editable ? (
        <p className="text-sm text-muted-foreground">
          {n === 0
            ? 'Delivers to no notification channel.'
            : `Delivers to ${n} notification channel${n === 1 ? '' : 's'}.`}
          {org && n > 0 && " They belong to the app creator's own account."}
        </p>
      ) : channels.isPending ? (
        <InlinePhase phase="loading" />
      ) : (
        <ChannelEditor
          key={bound.join(',')}
          slug={slug}
          rule={rule}
          channels={channels.data ?? []}
        />
      )}
    </section>
  );
}

function ChannelEditor({
  slug,
  rule,
  channels,
}: {
  slug: string;
  rule: AlertRule;
  channels: { id: string; name: string; kind: string }[];
}) {
  const { toast } = useToast();
  const update = useUpdateAlert(slug);
  const initial = rule.channel_ids ?? [];
  const [picked, setPicked] = useState<string[]>(initial);
  const changed = picked.length !== initial.length || picked.some((id) => !initial.includes(id));
  // apid refuses a rule with neither a webhook nor a channel (updatedRuleChannels).
  const stranded = !rule.webhook_url && picked.length === 0;
  const known = new Set(channels.map((c) => c.id));
  const missing = initial.filter((id) => !known.has(id));

  if (channels.length === 0 && initial.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No channels yet. Add one under Notification channels, then choose it here.
      </p>
    );

  return (
    <div className="flex flex-col gap-3">
      <span className="flex flex-wrap gap-x-5 gap-y-2">
        {channels.map((c) => {
          const checked = picked.includes(c.id);
          return (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={checked}
                disabled={!checked && picked.length >= MAX_CHANNELS_PER_RULE}
                onChange={(e) =>
                  setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))
                }
                className="accent-[var(--brand)]"
              />
              <span className="font-mono">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.kind}</span>
            </label>
          );
        })}
      </span>
      {missing.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Also bound to {missing.length} channel{missing.length === 1 ? '' : 's'} this account
          cannot see.
        </p>
      )}
      {stranded && (
        <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
          This rule has no webhook, so it needs a webhook or at least one channel.
        </p>
      )}
      <div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!changed || stranded}
          busy={update.isPending}
          onClick={() =>
            void update
              .mutateAsync({ id: rule.id, channel_ids: picked })
              .then(() => toast({ kind: 'success', title: 'Channels saved' }))
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not save channels', error: err })
              )
          }
        >
          Save channels
        </Button>
      </div>
    </div>
  );
}
