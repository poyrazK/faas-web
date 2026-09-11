import { CheckCircle, Clock, MinusCircle, RefreshDouble, XmarkCircle } from 'iconoir-react';
import { cn } from '@/lib/utils';
import { releaseStatusColor } from './release-status';

/** Text and shape carry the state as well as color; build and deployment labels stay distinct. */
export function ReleaseStatusLabel({
  status,
  compact = false,
}: {
  status: string;
  compact?: boolean;
}) {
  const color = releaseStatusColor(status);
  const Icon =
    color === 'var(--status-good)'
      ? CheckCircle
      : color === 'var(--status-critical)'
        ? XmarkCircle
        : color === 'var(--status-warning)'
          ? RefreshDouble
          : status.toLowerCase() === 'queued'
            ? Clock
            : MinusCircle;

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-2 font-medium capitalize',
        compact ? 'text-xs' : 'text-sm'
      )}
      style={{ color }}
    >
      <Icon aria-hidden="true" className={cn('shrink-0', compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
      <span className="truncate" title={status}>
        {status}
      </span>
    </span>
  );
}
