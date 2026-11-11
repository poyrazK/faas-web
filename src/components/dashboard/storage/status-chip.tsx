import type { ComponentType, SVGProps } from 'react';
import { cn } from '@/lib/utils';

export type ChipTone = 'good' | 'warning' | 'critical' | 'muted' | 'brand';

const TONE: Record<ChipTone, string> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  muted: 'var(--chart-muted)',
  brand: 'var(--brand)',
};

/**
 * A bucket setting's or a version's state: colour, icon and word together, so
 * the state never rests on hue alone (the rule `StateBadge` keeps for runs).
 */
export function StatusChip({
  tone,
  icon: Icon,
  label,
  spin = false,
  className,
}: {
  tone: ChipTone;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  spin?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs',
        className
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${TONE[tone]} 14%, transparent)`,
        color: TONE[tone],
      }}
    >
      <Icon
        aria-hidden="true"
        className={cn('h-3 w-3', spin && 'animate-spin motion-reduce:animate-none')}
      />
      {label}
    </span>
  );
}
