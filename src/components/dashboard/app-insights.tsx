import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Panel, StatTile } from '@/components/dashboard/primitives';
import { PlanGated } from '@/components/dashboard/plan-gated';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useAppEnvDiff,
  useAppStaticEgressIP,
  useAppStreamingCap,
  useAppUsage,
  useAppWakeTimeline,
  useClearAppStaticEgressIP,
  useSetAppStaticEgressIP,
  type AppStreamingStatus,
  type AppWakeTimeline,
} from '@/lib/api/queries';
import { formatCompact, formatRelative } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

/**
 * The five per-app reads that had CLI verbs and no console equivalent. Each
 * is a panel or a row on a page that already exists — none of them is a page.
 *
 * - Wake timeline: where recent wakes spent their time. This is the number
 *   the product is sold on, so it gets tiles for the aggregate and one row
 *   per wake with the tier, the trigger, and `ready_in_ms` as measured.
 * - Usage: the trailing-30-day billing summary for this app alone.
 * - Env diff: presence and value-equality across scopes, as the API renders
 *   it — a hash where the value is write-only, the value where it is not.
 * - Static egress IP (ADR-119): Scale-only. The read is never gated;
 *   `plan_allowed=false` is the answer.
 * - Streaming classification (ADR-102): why responses do or do not stream.
 *
 * Every value is the API's; nothing is derived. Histograms are categorical
 * counts and render as a list, not a chart.
 */

function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : formatRelative(ms);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

const TIER_COLOR: Record<string, string> = {
  warm: 'var(--status-good)',
  init: 'var(--status-warning)',
  cold_boot_fallback: 'var(--status-serious)',
};

export function WakeTimelinePanel({ slug }: { slug: string }) {
  const timeline = useAppWakeTimeline(slug);
  const data = timeline.data;
  const state = timeline.isPending ? 'loading' : timeline.error ? 'unavailable' : 'ready';
  const classes = Object.entries(data?.trigger_class_histogram ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <PlanGated error={timeline.error} feature="Wake timeline">
      <Panel
        title="Wake timeline"
        description="Where each wake in the last 24 hours spent its time, as the platform measured it."
      >
        {timeline.error ? (
          <p className="text-sm text-muted-foreground">{errorMessage(timeline.error)}</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile label="Wakes (24h)" value={data?.wake_count_24h} state={state} />
              <StatTile
                label="At capacity"
                value={data?.at_capacity_count}
                note={
                  data
                    ? `${data.at_capacity_pct}% of wakes queued behind a full instance`
                    : undefined
                }
                state={state}
                tone="orange"
              />
              <StatTile
                label="With timing"
                value={data?.wake_count_with_meta}
                note="wakes that recorded ready_in_ms"
                state={state}
                tone="grey"
              />
            </div>
            {classes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                By trigger class:{' '}
                {classes.map(([k, v], i) => (
                  <span key={k}>
                    {i > 0 && ' · '}
                    <span className="text-foreground">{k}</span> {v}
                  </span>
                ))}
              </p>
            )}
            {data && data.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No wakes in the last 24 hours.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {(data?.rows ?? []).map((row: AppWakeTimeline['rows'][number], i) => (
                  <li
                    key={row.wake_id ?? `${row.at}-${i}`}
                    className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0 text-xs"
                  >
                    <Pill
                      label={row.tier ?? 'unknown'}
                      color={TIER_COLOR[row.tier ?? ''] ?? 'var(--status-idle)'}
                    />
                    <span className="font-mono">{row.trigger ?? '—'}</span>
                    {row.trigger_class && (
                      <span className="text-muted-foreground">{row.trigger_class}</span>
                    )}
                    {row.at_capacity && (
                      <span style={{ color: 'var(--status-warning)' }}>
                        queued {row.queued_count ?? 0}
                      </span>
                    )}
                    <span className="ml-auto font-mono [font-variant-numeric:tabular-nums]">
                      {row.ready_in_ms != null && row.ready_in_ms >= 0
                        ? `${row.ready_in_ms} ms`
                        : '—'}
                    </span>
                    <span className="w-16 text-right text-muted-foreground">
                      {relativeTime(row.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data && (
              <p className="text-xs text-muted-foreground">As of {relativeTime(data.as_of)}.</p>
            )}
          </div>
        )}
      </Panel>
    </PlanGated>
  );
}

export function AppUsagePanel({ slug }: { slug: string }) {
  const usage = useAppUsage(slug);
  const data = usage.data;
  const state = usage.isPending ? 'loading' : usage.error ? 'unavailable' : 'ready';

  return (
    <PlanGated error={usage.error} feature="Per-app usage">
      <Panel
        title="Usage"
        description={
          data
            ? `${new Date(data.period_start).toLocaleDateString()} – ${new Date(data.period_end).toLocaleDateString()}, from ${data.source.replace('_', ' ')}.`
            : 'Trailing 30 days of billing usage for this app alone.'
        }
      >
        {usage.error ? (
          <p className="text-sm text-muted-foreground">{errorMessage(usage.error)}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile
              label="GB-hours"
              value={data ? data.gb_hours.toFixed(2) : undefined}
              note={data ? `of ${data.plan_included_gb_hours} included` : undefined}
              state={state}
            />
            <StatTile
              label="Overage"
              value={data ? data.overage_gb_hours.toFixed(2) : undefined}
              unit="GB-h"
              state={state}
              tone={data && data.overage_gb_hours > 0 ? 'orange' : 'grey'}
            />
            <StatTile
              label="Requests"
              value={data ? formatCompact(data.requests) : undefined}
              state={state}
            />
            <StatTile
              label="Egress"
              value={data ? formatBytes(data.tx_bytes) : undefined}
              state={state}
            />
            <StatTile
              label="Cold boots"
              value={data?.cold_boot_count}
              state={state}
              tone="orange"
            />
            <StatTile
              label="Builder"
              value={data ? Math.round(data.builder_seconds) : undefined}
              unit="s"
              state={state}
              tone="grey"
            />
          </div>
        )}
      </Panel>
    </PlanGated>
  );
}

export function EnvDiffPanel({ slug }: { slug: string }) {
  const diff = useAppEnvDiff(slug);
  const data = diff.data;

  return (
    <Panel
      title="Across scopes"
      description="Which keys exist in each scope and whether their values agree. Secrets compare by hash; their values never leave the server."
    >
      {diff.isPending ? (
        <p className="text-sm text-muted-foreground">Comparing scopes…</p>
      ) : diff.error ? (
        <p className="text-sm text-muted-foreground">{errorMessage(diff.error)}</p>
      ) : !data || data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing to compare yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="label-mono py-1 pr-4 font-normal">Key</th>
                {data.scopes.map((s) => (
                  <th key={s} className="label-mono py-1 pr-4 font-normal">
                    {s}
                  </th>
                ))}
                <th className="label-mono py-1 font-normal">Agree</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const present = data.scopes.map((s) => row.cells[s]).filter((c) => c?.present);
                const hashes = new Set(present.map((c) => c.value_hash ?? c.value ?? ''));
                const agree = present.length === data.scopes.length && hashes.size <= 1;
                return (
                  <tr key={`${row.kind}:${row.key}`} className="border-t border-border">
                    <td className="py-1.5 pr-4 font-mono">
                      {row.key}
                      {row.kind === 'secret' && (
                        <span className="ml-2 text-muted-foreground">secret</span>
                      )}
                    </td>
                    {data.scopes.map((s) => {
                      const cell = row.cells[s];
                      return (
                        <td key={s} className="py-1.5 pr-4 font-mono">
                          {!cell?.present ? (
                            <span className="text-muted-foreground">missing</span>
                          ) : cell.value != null ? (
                            cell.value
                          ) : (
                            <span title="value hash">{(cell.value_hash ?? '').slice(0, 8)}</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-1.5">
                      <Pill
                        label={
                          agree
                            ? 'same'
                            : present.length < data.scopes.length
                              ? 'partial'
                              : 'differs'
                        }
                        color={
                          agree
                            ? 'var(--status-good)'
                            : present.length < data.scopes.length
                              ? 'var(--status-idle)'
                              : 'var(--status-warning)'
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted-foreground">
            Generated {relativeTime(data.generated_at)}.
          </p>
        </div>
      )}
    </Panel>
  );
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function StaticEgressIP({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const pin = useAppStaticEgressIP(slug);
  const set = useSetAppStaticEgressIP(slug);
  const clear = useClearAppStaticEgressIP(slug);
  const [ip, setIp] = useState('');
  const valid = IPV4.test(ip.trim());

  const onPin = async () => {
    try {
      const result = await set.mutateAsync(ip.trim());
      setIp('');
      toast({ kind: 'success', title: `Egress pinned to ${result.ip ?? ip.trim()}` });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'plan_static_egress_ip_not_allowed') {
        toast({
          kind: 'info',
          title: 'Not on your plan',
          description: 'Static egress IPs need the Scale plan.',
        });
        return;
      }
      if (err instanceof ApiError && err.code === 'plan_static_egress_ip_quota') {
        toast({ kind: 'info', title: 'IP already pinned', description: errorMessage(err) });
        return;
      }
      toast({ kind: 'error', title: 'Could not pin the IP', description: errorMessage(err) });
    }
  };

  const onClear = async () => {
    if (
      !(await confirm({
        title: 'Clear the static egress IP?',
        description: 'Outbound traffic goes back to the shared node addresses.',
        confirmLabel: 'Clear',
        destructive: true,
      }))
    )
      return;
    try {
      await clear.mutateAsync();
      toast({ kind: 'success', title: 'Egress pin cleared' });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not clear', description: errorMessage(err) });
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-mono text-muted-foreground">Static egress IP</span>
      {pin.isPending ? (
        <span className="text-xs text-muted-foreground">Reading the pin…</span>
      ) : pin.error ? (
        <span className="text-xs text-muted-foreground">{errorMessage(pin.error)}</span>
      ) : pin.data?.ip ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm">{pin.data.ip}</span>
          <span className="text-xs text-muted-foreground">
            pinned {relativeTime(pin.data.set_at)}
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void onClear()}
            disabled={clear.isPending}
          >
            Clear
          </Button>
        </div>
      ) : !pin.data?.plan_allowed ? (
        <span className="text-xs text-muted-foreground">
          Not pinned. Pinning outbound traffic to an IPv4 of your own needs the Scale plan.
        </span>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !set.isPending) void onPin();
          }}
        >
          <input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="203.0.113.42"
            spellCheck={false}
            aria-label="IPv4 address to pin"
            aria-invalid={(ip.length > 0 && !valid) || undefined}
            className={cn(FIELD, 'w-48')}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!valid} busy={set.isPending}>
            Pin
          </Button>
          <span className="text-xs text-muted-foreground">
            Your own public IPv4. {pin.data.plan_cap} per app on this plan.
          </span>
        </form>
      )}
    </div>
  );
}

/** The probe's verdict in one sentence, in the API's own vocabulary. */
export function streamingLine(cap: AppStreamingStatus): string {
  switch (cap.status) {
    case 'streaming':
      return `Streaming: responses stream up to ${formatBytes(cap.effective_cap_bytes)} (${cap.cap_kind === 'endpoint-rule' ? 'endpoint rule' : 'plan'} cap).`;
    case 'accept-json-downgrade':
      return 'Buffered for JSON: clients asking for application/json get the whole response at once; other clients stream.';
    case 'flag-disabled':
      return 'Not streaming: the flag above is off for this app.';
    case 'plan-disallows':
      return 'Not streaming: the current plan does not include streaming responses.';
    case 'operator-disabled':
      return 'Not streaming: disabled by the operator on this cluster.';
    case 'upgrade-bypass':
      return 'Streaming through an upgrade bypass (WebSocket or similar); the byte cap does not apply.';
  }
}

export function StreamingCapNote({ slug }: { slug: string }) {
  const cap = useAppStreamingCap(slug);
  return (
    <li className="py-3 text-xs text-muted-foreground first:pt-0 last:pb-0">
      {cap.isPending
        ? 'Checking how responses are classified…'
        : cap.error
          ? errorMessage(cap.error)
          : cap.data
            ? streamingLine(cap.data)
            : null}
    </li>
  );
}
