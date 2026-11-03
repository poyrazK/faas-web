import {
  CheckCircle,
  Circle,
  Clock,
  MinusCircle,
  RefreshDouble,
  WarningHexagon,
  WarningTriangle,
  XmarkCircle,
} from 'iconoir-react';

/**
 * Run and step states in colour, icon and words. `cancelled` is not an API
 * status: a cancelled run is `failed` with `cancelled_at` set
 * (handlers_workflows.go cancelWorkflowRun), and saying "failed" for an
 * operator's own cancel would send them looking for a bug.
 */
const STATES: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  pending: { label: 'Queued', color: 'var(--chart-muted)', icon: Clock },
  running: { label: 'Running', color: 'var(--status-warning)', icon: RefreshDouble },
  awaiting_event: { label: 'Waiting', color: 'var(--status-warning)', icon: Clock },
  retrying: { label: 'Retrying', color: 'var(--status-warning)', icon: RefreshDouble },
  succeeded: { label: 'Succeeded', color: 'var(--status-good)', icon: CheckCircle },
  failed: { label: 'Failed', color: 'var(--status-critical)', icon: WarningTriangle },
  dead: { label: 'Dead', color: 'var(--status-critical)', icon: WarningHexagon },
  cancelled: { label: 'Cancelled', color: 'var(--chart-muted)', icon: XmarkCircle },
  skipped: { label: 'Skipped', color: 'var(--chart-muted)', icon: MinusCircle },
};

export function runState(run: { status: string; cancelled_at?: string | null }): string {
  return run.cancelled_at ? 'cancelled' : run.status;
}

export function WorkflowStatus({ status }: { status: string }) {
  const cfg = STATES[status] ?? {
    label: status.replaceAll('_', ' '),
    color: 'var(--chart-muted)',
    icon: Circle,
  };
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{
        borderColor: `color-mix(in oklab, ${cfg.color} 35%, transparent)`,
        color: cfg.color,
      }}
    >
      <Icon aria-hidden className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}
