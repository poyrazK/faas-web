import {
  CheckCircle,
  Circle,
  Clock,
  Flash,
  MinusCircle,
  RefreshDouble,
  WarningHexagon,
  WarningTriangle,
  XmarkCircle,
} from 'iconoir-react';

/**
 * Task, attempt and schedule-occurrence states in colour, icon and words.
 * `timeout` and `oom` stay apart from `failed`: one wants a longer
 * task_timeout_sec, the other more ram_mb. A skipped, missed or coalesced
 * occurrence is a recorded decision, not a failure, so it is not red.
 */
const STATES: Record<string, { label: string; color: string; icon: typeof CheckCircle }> = {
  pending: { label: 'Pending', color: 'var(--chart-muted)', icon: Clock },
  queued: { label: 'Queued', color: 'var(--chart-muted)', icon: Clock },
  claimed: { label: 'Running', color: 'var(--status-warning)', icon: RefreshDouble },
  running: { label: 'Running', color: 'var(--status-warning)', icon: RefreshDouble },
  waiting_replacement: {
    label: 'Waiting to replace',
    color: 'var(--status-warning)',
    icon: RefreshDouble,
  },
  succeeded: { label: 'Succeeded', color: 'var(--status-good)', icon: CheckCircle },
  failed: { label: 'Failed', color: 'var(--status-critical)', icon: WarningTriangle },
  timeout: { label: 'Timed out', color: 'var(--status-serious)', icon: Clock },
  oom: { label: 'Out of memory', color: 'var(--status-critical)', icon: Flash },
  cancelled: { label: 'Cancelled', color: 'var(--chart-muted)', icon: XmarkCircle },
  skipped_overlap: {
    label: 'Skipped: still running',
    color: 'var(--chart-muted)',
    icon: MinusCircle,
  },
  missed_deadline: {
    label: 'Missed start deadline',
    color: 'var(--status-serious)',
    icon: WarningHexagon,
  },
  coalesced: { label: 'Coalesced', color: 'var(--chart-muted)', icon: MinusCircle },
  uncertain: { label: 'Uncertain', color: 'var(--status-serious)', icon: WarningHexagon },
};

export function JobStatusBadge({ status }: { status: string }) {
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
