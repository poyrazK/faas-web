import { useState, type ReactNode } from 'react';
import { EditPencil, Trash } from 'iconoir-react';
import { Area, AreaChart, Grid, Tooltip, XAxis, YAxis } from '@/components/dither-kit';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import {
  useDeleteLogDrain,
  useLogDrainAnalytics,
  useLogDrainHealth,
  useUpdateLogDrain,
  type LogDrain,
  type LogDrainWindow,
} from '@/lib/api/log-drains';
import { Timestamp } from './events/event-format';
import { EditLogDrain } from './log-drain-edit';
import { kindLabel } from './log-drain-form';
import { InlinePhase, Panel, StatTile, queryPhase } from './primitives';
import { SegmentedControl } from './tabs';

const WINDOWS: LogDrainWindow[] = ['1h', '24h', '7d', '30d'];
const HEALTH: Record<string, string> = {
  healthy: 'var(--status-good)',
  degraded: 'var(--status-warning)',
  inactive: 'var(--muted-foreground)',
  unknown: 'var(--muted-foreground)',
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <span className="label-mono text-muted-foreground">{label}</span>
      <span className="truncate text-sm tabular-nums">{children}</span>
    </li>
  );
}

/**
 * One destination: its delivery health (apid's durable counters and queue,
 * faas handlers_log_drains.go:247) and its hourly delivery history (a real
 * series, app_log_drain_analytics.go:65), with pause, edit and delete.
 */
export function LogDrainDetail({
  slug,
  drain,
  onClose,
}: {
  slug: string;
  drain: LogDrain;
  onClose: () => void;
}) {
  const [window, setWindow] = useState<LogDrainWindow>('24h');
  const [editing, setEditing] = useState(false);
  const health = useLogDrainHealth(slug, drain.id);
  const analytics = useLogDrainAnalytics(slug, drain.id, window);
  const update = useUpdateLogDrain(slug);
  const remove = useDeleteLogDrain(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const h = health.data;
  const points = (analytics.data?.buckets ?? []).map((b) => ({
    at: new Date(b.start).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' }),
    delivered: b.delivered,
    failed: b.failed + b.dropped,
  }));
  const setEnabled = (enabled: boolean) =>
    void update
      .mutateAsync({ id: drain.id, body: { enabled } })
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not update', description: errorMessage(err) })
      );
  return (
    <Panel
      title={drain.target_url}
      description={kindLabel(drain)}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs">
            <Switch
              checked={drain.enabled}
              onCheckedChange={setEnabled}
              aria-label="Deliver logs to this destination"
            />
            {drain.enabled ? 'Enabled' : 'Paused'}
          </label>
          <Button size="xs" variant="outline" className="gap-1" onClick={() => setEditing(true)}>
            <EditPencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            size="xs"
            variant="outline"
            className="gap-1"
            onClick={async () => {
              if (
                !(await confirm({
                  title: 'Delete this log destination?',
                  description:
                    'Logs stop being delivered to it immediately. Logs already delivered are unaffected.',
                  confirmLabel: 'Delete destination',
                  destructive: true,
                }))
              )
                return;
              void remove
                .mutateAsync(drain.id)
                .then(() => {
                  toast({ kind: 'success', title: 'Log destination deleted' });
                  onClose();
                })
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not delete',
                    description: errorMessage(err),
                  })
                );
            }}
          >
            <Trash className="h-3.5 w-3.5" />
            Delete
          </Button>
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {h ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span
                aria-hidden
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: HEALTH[h.status] ?? HEALTH.unknown }}
              />
              <span className="font-medium">{h.status}</span>
              {h.last_error && <span className="text-muted-foreground">{h.last_error}</span>}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Delivered" value={h.delivered_total.toLocaleString()} />
              <StatTile label="Failed" value={h.failed_total.toLocaleString()} />
              <StatTile label="Dropped" value={h.dropped_total.toLocaleString()} />
              <StatTile label="Queue" value={`${h.queue_depth} / ${h.queue_capacity}`} />
            </div>
            <ul
              aria-label="Delivery health"
              className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 xl:grid-cols-6"
            >
              <Fact label="Last delivered">
                {h.last_success_at ? <Timestamp iso={h.last_success_at} /> : 'Never'}
              </Fact>
              <Fact label="Last failed">
                {h.last_failure_at ? <Timestamp iso={h.last_failure_at} /> : 'Never'}
              </Fact>
              <Fact label="Oldest undelivered line">
                {h.oldest_pending_at ? <Timestamp iso={h.oldest_pending_at} /> : 'Nothing waiting'}
              </Fact>
              <Fact label="Retries">{h.retries_total.toLocaleString()}</Fact>
              <Fact label="Dead-lettered">{h.dead_letter_total.toLocaleString()}</Fact>
              <Fact label="Stream gaps">{h.gaps_total.toLocaleString()}</Fact>
            </ul>
            {/* Until gatewayd writes its first snapshot apid answers "unknown"
                stamped with the drain's own update time, not a report. */}
            <p className="text-xs text-muted-foreground">
              {h.status === 'unknown' ? (
                'No delivery report yet. One arrives once this app writes logs.'
              ) : (
                <>
                  Reported by the log pipeline <Timestamp iso={h.updated_at} />.
                </>
              )}
            </p>
          </>
        ) : (
          <InlinePhase
            phase={queryPhase({ error: health.error, loading: health.isPending })}
            error={health.error}
            loadingMessage="Reading delivery health…"
            onRetry={() => void health.refetch()}
          />
        )}
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="label-mono text-muted-foreground">Delivery</p>
            <SegmentedControl
              label="Delivery window"
              value={window}
              options={WINDOWS.map((w) => ({ key: w, label: w }))}
              onChange={setWindow}
            />
          </div>
          {points.length >= 2 ? (
            <AreaChart
              data={points}
              config={{
                delivered: { label: 'Delivered', color: 'green' },
                failed: { label: 'Failed or dropped', color: 'red' },
              }}
              className="h-40 w-full"
            >
              <Grid />
              <XAxis dataKey="at" />
              <YAxis />
              <Tooltip />
              <Area dataKey="delivered" />
              <Area dataKey="failed" />
            </AreaChart>
          ) : (
            <InlinePhase
              phase={queryPhase({
                error: analytics.error,
                loading: analytics.isPending,
                isEmpty: true,
              })}
              error={analytics.error}
              emptyMessage="Not enough delivery history in this window to draw."
              onRetry={() => void analytics.refetch()}
            />
          )}
          {analytics.data && (
            <p className="mt-2 text-xs text-muted-foreground">
              {(analytics.data.summary.success_rate * 100).toFixed(1)}% delivered ·{' '}
              {Math.round(analytics.data.summary.average_latency_ms)} ms average delivery ·{' '}
              {analytics.data.summary.retries} retries
            </p>
          )}
        </div>
      </div>
      {editing && <EditLogDrain slug={slug} drain={drain} onClose={() => setEditing(false)} />}
    </Panel>
  );
}
