import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { billStatus, type BillStatus } from '@/lib/limits';
import { TONE_COLOR } from './limit-row';
import type { BillData } from './use-bill-facts';

const ACTION_LABEL: Record<NonNullable<BillStatus['action']>, string> = {
  cap: 'Change cap',
  egress: 'Pay beyond',
  plans: 'View plans',
  storage: 'See buckets',
};

/**
 * The answer first: whether anything is stopped, what is close, or that
 * nothing is, with the one action that lifts a stop. It waits for every
 * shown read rather than guess while one is loading.
 */
export function StatusStrip({
  data,
  onAction,
  alsoClose,
  waitFor = true,
}: {
  data: BillData;
  onAction: (action: 'cap' | 'egress') => void;
  /** Reached limits outside the bill, such as an agent at its budget. */
  alsoClose?: string[];
  /** False while another read the strip counts is still answering. */
  waitFor?: boolean;
}) {
  const settled = data.settled && waitFor;
  const status = settled
    ? billStatus(alsoClose ? { ...data.facts, alsoClose } : data.facts)
    : undefined;
  const color = status ? TONE_COLOR[status.tone] : undefined;
  // One live region for the strip's whole life: the settled sentence replaces
  // the checking text inside it, so screen readers announce the answer. The
  // action sits outside it, so it isn't read out with every change.
  return (
    <section
      aria-label="Spending limits"
      className={
        status
          ? 'flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3 ring-1'
          : 'flex flex-col gap-2 rounded-xl bg-muted/40 px-4 py-3'
      }
      style={
        color
          ? {
              background: `color-mix(in oklab, ${color} 10%, transparent)`,
              borderColor: color,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 25%, transparent)`,
            }
          : undefined
      }
    >
      <div
        role="status"
        aria-live="polite"
        aria-label="Spending limits status"
        className={status ? 'min-w-0' : 'flex flex-col gap-2'}
      >
        {status ? (
          <>
            <p className="text-sm font-semibold" style={{ color }}>
              {status.headline}
            </p>
            {status.detail && (
              <p className="mt-0.5 text-xs leading-relaxed text-foreground/80">{status.detail}</p>
            )}
          </>
        ) : (
          <>
            <span className="sr-only">Checking the limits…</span>
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-2/3 max-w-md" />
          </>
        )}
      </div>
      {status?.action === 'plans' ? (
        <Button asChild size="sm" variant="outline">
          <Link to="/dashboard/plans">{ACTION_LABEL.plans}</Link>
        </Button>
      ) : status?.action === 'storage' ? (
        <Button asChild size="sm" variant="outline">
          <Link to="/dashboard/storage">{ACTION_LABEL.storage}</Link>
        </Button>
      ) : status?.action ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAction(status.action as 'cap' | 'egress')}
        >
          {ACTION_LABEL[status.action]}
        </Button>
      ) : null}
    </section>
  );
}
