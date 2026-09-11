/** Shared operational status colors for release rows and their detail. */
export function releaseStatusColor(status: string): string | undefined {
  const value = status.toLowerCase();
  if (['queued', 'superseded', 'cancelled'].includes(value)) return 'var(--chart-muted)';
  if (['active', 'live', 'complete', 'completed', 'succeeded'].includes(value))
    return 'var(--status-good)';
  if (['failed', 'error', 'crashed'].includes(value)) return 'var(--status-critical)';
  if (
    [
      'running',
      'building',
      'deploying',
      'pending',
      'dispatching',
      'imaging',
      'snapshotting',
    ].includes(value)
  )
    return 'var(--status-warning)';
  return 'var(--chart-muted)';
}

export const RELEASE_SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'var(--status-critical)',
  HIGH: 'var(--status-serious)',
  MEDIUM: 'var(--status-warning)',
};
