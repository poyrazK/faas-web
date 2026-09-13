import { Button } from '@/components/ui/button';
import type { FailureSummary } from './failure-summary';

export interface FailurePanelProps {
  summary: FailureSummary;
  onViewOutput: () => void;
  onRetryOptions?: () => void;
}

/** Shared evidence view. Its owner controls navigation and all mutations. */
export function FailurePanel({ summary, onViewOutput, onRetryOptions }: FailurePanelProps) {
  return (
    <section
      aria-label="Failure explanation"
      className="min-w-0 rounded-lg border border-border bg-background/40 p-4 sm:p-5"
    >
      <h3 className="text-sm font-medium">What happened</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]">
        {summary.cause}
      </p>
      <div className="mt-4 border-l-2 border-brand/50 pl-3">
        <h3 className="text-sm font-medium">Next step</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {summary.nextStep}
        </p>
      </div>
      {summary.evidence.length > 0 && (
        <div className="mt-5">
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Relevant evidence</h3>
          <Excerpts rows={summary.evidence.slice(0, 3)} />
          {summary.evidence.length > 3 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand">
                Show {summary.evidence.length - 3} more excerpts
              </summary>
              <div className="mt-2">
                <Excerpts rows={summary.evidence.slice(3)} />
              </div>
            </details>
          )}
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onViewOutput}>
          View build output
        </Button>
        {onRetryOptions && (
          <Button size="sm" variant="outline" onClick={onRetryOptions}>
            Retry options
          </Button>
        )}
      </div>
      {summary.code && (
        <details className="mt-4 border-t border-border pt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand">
            Technical details
          </summary>
          <dl className="mt-2 text-xs">
            <dt className="text-muted-foreground">Error code</dt>
            <dd className="mt-1 break-all font-mono">{summary.code}</dd>
          </dl>
        </details>
      )}
    </section>
  );
}

function Excerpts({ rows }: { rows: FailureSummary['evidence'] }) {
  return (
    <ol className="divide-y divide-border rounded-md border border-border">
      {rows.map((row, index) => (
        <li key={index} className="min-w-0 px-3 py-2.5">
          {(row.source || row.ts || row.level) && (
            <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {row.source && <span>{row.source}</span>}
              {row.level && <span>{row.level}</span>}
              {row.ts && <time dateTime={row.ts}>{row.ts}</time>}
            </div>
          )}
          <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
            {row.message}
          </p>
        </li>
      ))}
    </ol>
  );
}
