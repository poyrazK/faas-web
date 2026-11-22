import { useId, useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { useInView } from 'motion/react';
import { PUBLIC_STATUS_LABELS, usePublicStatus, type PublicStatusState } from '@/lib/api/status';

const STATUS_DOT: Record<PublicStatusState, string> = {
  operational: 'bg-status-good',
  maintenance: 'bg-brand',
  degraded: 'bg-status-warning',
  partial_outage: 'bg-status-serious',
  major_outage: 'bg-status-critical',
  unknown: 'bg-muted-foreground',
};

export function FooterStatusLink({ className, children }: { className: string; children: string }) {
  const id = useId();
  const ref = useRef<HTMLAnchorElement>(null);
  const inView = useInView(ref);
  const { data, isError, isPending } = usePublicStatus(inView);
  const state = data?.data_status === 'fresh' && !isError ? data.overall_status : 'unknown';

  let label = PUBLIC_STATUS_LABELS[state];
  if (isPending) label = 'Checking status';
  if (data && (isError || data.data_status === 'stale')) label = 'Updates delayed';

  return (
    <Link
      ref={ref}
      to="/status"
      className={className}
      aria-labelledby={id}
      aria-describedby={`${id}-current`}
    >
      <span className="flex flex-col gap-1">
        <span id={id}>{children}</span>
        <span id={`${id}-current`} className="flex items-start gap-1.5 text-xs leading-snug">
          <span
            aria-hidden
            className={`mt-1 size-1.5 shrink-0 rounded-full ${STATUS_DOT[state]}`}
          />
          {label}
        </span>
      </span>
    </Link>
  );
}
