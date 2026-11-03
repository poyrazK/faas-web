import { useState } from 'react';
import { CheckCircle, RefreshDouble, WarningTriangle, XmarkCircle } from 'iconoir-react';
import { Timestamp } from '@/components/ui/timestamp';
import { useCapabilityStage } from '@/lib/api/capabilities';
import {
  ROLLBACK_STATUS,
  useAlertRollback,
  useAlertRollbacks,
  type AlertRollback,
} from '@/lib/api/alert-rollbacks';
import { InlinePhase, Panel, queryPhase } from './primitives';

const STYLE: Record<AlertRollback['status'], { color: string; icon: typeof CheckCircle }> = {
  pending: { color: 'var(--status-warning)', icon: RefreshDouble },
  blocked: { color: 'var(--status-serious)', icon: WarningTriangle },
  complete: { color: 'var(--status-good)', icon: CheckCircle },
  failed: { color: 'var(--status-critical)', icon: XmarkCircle },
};

export function RollbackStatus({ status }: { status: AlertRollback['status'] }) {
  const { color, icon: Icon } = STYLE[status] ?? STYLE.failed;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium" style={{ color }}>
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {ROLLBACK_STATUS[status] ?? status}
    </span>
  );
}

const short = (id?: string) => (id ? id.slice(0, 8) : '—');

/** One fire's receipt, read fresh and refreshed while it is in flight. */
function RollbackReceipt({ slug, fire }: { slug: string; fire: string }) {
  const read = useAlertRollback(slug, fire);
  const r = read.data;
  const phase = queryPhase({ error: read.error, loading: read.isPending });
  if (phase !== 'ready' || !r)
    return (
      <InlinePhase
        phase={phase}
        error={read.error}
        loadingMessage="Reading the receipt…"
        onRetry={() => void read.refetch()}
      />
    );
  const e = r.deployment_evidence;
  return (
    <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
      <div>
        <dt className="label-mono text-muted-foreground">Kind</dt>
        <dd>
          {r.service
            ? 'Service handoff aborted'
            : r.historical
              ? 'Completed release rolled back after cutover'
              : 'Canary aborted'}
        </dd>
      </div>
      <div>
        <dt className="label-mono text-muted-foreground">Phase</dt>
        <dd className="font-mono">{r.rollback_phase ?? r.service_phase ?? '—'}</dd>
      </div>
      {r.code && (
        <div>
          <dt className="label-mono text-muted-foreground">Code</dt>
          <dd className="font-mono">{r.code}</dd>
        </div>
      )}
      {r.completed_at && (
        <div>
          <dt className="label-mono text-muted-foreground">Completed</dt>
          <dd>
            <Timestamp value={r.completed_at} mode="absolute" />
          </dd>
        </div>
      )}
      {r.rollback_operation_id && (
        <div>
          <dt className="label-mono text-muted-foreground">Rollback operation</dt>
          <dd className="font-mono">{short(r.rollback_operation_id)}</dd>
        </div>
      )}
      {e && (
        <div className="sm:col-span-2">
          <dt className="label-mono text-muted-foreground">Evidence</dt>
          <dd>
            {e.server_errors} of {e.requests} requests were 5xx ({e.error_rate_pct.toFixed(1)}%,
            rule {e.comparison} {e.threshold}%) from{' '}
            <Timestamp value={e.window_start} mode="absolute" /> to{' '}
            <Timestamp value={e.window_end} mode="absolute" />, after cutover at{' '}
            <Timestamp value={e.cutover_at} mode="absolute" /> · {e.status}
            {e.code && ` (${e.code})`}
          </dd>
        </div>
      )}
      {r.blockers && r.blockers.length > 0 && (
        <div className="sm:col-span-2">
          <dt className="label-mono text-muted-foreground">Blocked by</dt>
          <dd>
            <ul className="flex flex-col gap-0.5">
              {r.blockers.map((b) => (
                <li key={`${b.code}-${b.binding ?? b.name ?? ''}`}>
                  <code className="font-mono">{b.code}</code> {b.message}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * The app's automatic rollbacks: each production alert fire with a rollback
 * action, what it pinned, and how far the rollback got. Mount it behind the
 * `alert-rollbacks` capability.
 */
export function AlertRollbacks({ slug }: { slug: string }) {
  const list = useAlertRollbacks(slug);
  const stage = useCapabilityStage('alert-rollbacks');
  const [open, setOpen] = useState<string | null>(null);
  const rows = list.data ?? [];
  const phase = queryPhase({
    error: list.error,
    loading: list.isPending,
    isEmpty: rows.length === 0,
  });
  return (
    <section aria-label="Automatic rollbacks">
      <Panel
        title="Automatic rollbacks"
        description={`${stage ? `${stage} · ` : ''}Rules whose action is roll back abort the canary that was rolling out when they fired and restore the release it replaced. The 32 most recent are kept.`}
        padded={false}
      >
        {phase !== 'ready' ? (
          <div className="p-5">
            <InlinePhase
              phase={phase}
              error={list.error}
              loadingMessage="Reading automatic rollbacks…"
              emptyMessage="No alert has rolled this app back."
              onRetry={() => void list.refetch()}
            />
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 px-5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <RollbackStatus status={r.status} />
                    <span>{r.reason}</span>
                    <span className="text-xs text-muted-foreground">
                      observed {r.observed_value} · fired <Timestamp value={r.fired_at} />
                    </span>
                  </p>
                  <button
                    type="button"
                    aria-expanded={open === r.id}
                    onClick={() => setOpen((v) => (v === r.id ? null : r.id))}
                    className="text-xs text-brand underline-offset-4 hover:underline"
                  >
                    {open === r.id ? 'Hide receipt' : 'Receipt'}
                  </button>
                </div>
                <p className="font-mono text-xs text-muted-foreground">
                  {short(r.candidate_deployment_id)} → {short(r.predecessor_deployment_id)} · scope{' '}
                  {r.scope}
                </p>
                {open === r.id && <RollbackReceipt slug={slug} fire={r.id} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}
