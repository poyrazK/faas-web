import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'iconoir-react';
import { billStatus } from '@/lib/limits';
import { TONE_COLOR } from './limit-row';
import { useBillFacts } from './use-bill-facts';

/**
 * Usage's one line on spending limits: the status strip's answer and the way
 * to the page that holds every limit.
 */
export function LimitsSummary() {
  const data = useBillFacts();
  const status = data.settled ? billStatus(data.facts) : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 px-4 py-3 text-sm">
      <p role="status" aria-label="Spending limits" className="min-w-0">
        {status ? (
          <>
            <span className="font-medium" style={{ color: TONE_COLOR[status.tone] }}>
              {status.headline}
            </span>
            {status.detail && <span className="text-muted-foreground"> · {status.detail}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">Checking your limits…</span>
        )}
      </p>
      <Link
        to="/dashboard/limits"
        className="inline-flex items-center gap-1 text-xs font-medium text-brand underline-offset-4 hover:underline"
      >
        Open spending limits
        <ArrowRight aria-hidden className="h-3 w-3" />
      </Link>
    </div>
  );
}
