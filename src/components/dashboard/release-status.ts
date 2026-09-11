/** Shared operational status colors for release rows and their detail. */
export function releaseStatusColor(status: string): string | undefined {
  const value = status.toLowerCase();
  if (value === 'queued') return 'var(--chart-muted)';
  if (['active', 'live', 'complete', 'completed', 'succeeded', 'superseded'].includes(value))
    return 'var(--status-good)';
  if (['failed', 'error', 'crashed', 'cancelled'].includes(value)) return 'var(--status-critical)';
  if (['running', 'building', 'pending', 'dispatching', 'imaging', 'snapshotting'].includes(value))
    return 'var(--status-warning)';
  return undefined;
}

export const RELEASE_SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'var(--status-critical)',
  HIGH: 'var(--status-serious)',
  MEDIUM: 'var(--status-warning)',
};
