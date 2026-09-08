import { Modal } from '@/components/ui/modal';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useDebugRequestEvidence } from '@/lib/api/queries';

/**
 * One request, in full: the telemetry row, the spans the gateway recorded
 * under it, and the platform's own explanation (ADR-127).
 *
 * `explanation.status` is the API's verdict — `regression_detected` when it
 * matched this request to a known regression, `unobserved` when it has
 * nothing to compare against. The headline is the platform's sentence, shown
 * as written rather than re-worded, and `primary_span` is the span it blames.
 * Spans are listed in the order returned with their own durations; a
 * truncated span list says so.
 */

function ms(nanos: number): string {
  const value = nanos / 1_000_000;
  return value < 1 ? `${value.toFixed(2)} ms` : `${Math.round(value)} ms`;
}

export function DebugRequestEvidence({
  slug,
  reqId,
  onClose,
}: {
  slug: string;
  reqId: string | null;
  onClose: () => void;
}) {
  const evidence = useDebugRequestEvidence(slug, reqId ?? '');
  const data = evidence.data;
  const missing = evidence.error instanceof ApiError && evidence.error.code === 'not_found';
  const primaryId = data?.explanation.primary_span?.span_id;

  return (
    <Modal
      open={reqId !== null}
      onClose={onClose}
      title={data ? `${data.request.method} ${data.request.route}` : 'Request evidence'}
      description={
        data
          ? `${data.request.status} · ${data.request.latency_ms} ms · ${new Date(data.request.received_at).toLocaleString()}`
          : undefined
      }
      width="max-w-3xl"
    >
      {evidence.isPending ? (
        <p className="text-sm text-muted-foreground">Collecting the evidence…</p>
      ) : missing ? (
        <p className="text-sm text-muted-foreground">
          No telemetry is kept for this request any more.
        </p>
      ) : evidence.error || !data ? (
        <p className="text-sm text-muted-foreground">{errorMessage(evidence.error)}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Pill
                label={
                  data.explanation.status === 'regression_detected' ? 'regression' : 'unobserved'
                }
                color={
                  data.explanation.status === 'regression_detected'
                    ? 'var(--status-serious)'
                    : 'var(--status-idle)'
                }
              />
              {data.request.cold_boot && <Pill label="cold boot" color="var(--status-warning)" />}
            </div>
            <p className="text-sm">{data.explanation.headline}</p>
          </div>

          {data.regression && (
            <div className="rounded-lg border border-border p-3 text-xs">
              <p className="label-mono mb-1.5 text-muted-foreground">Matched regression</p>
              <p className="[font-variant-numeric:tabular-nums]">
                {data.regression.route}: p95 {data.regression.p95_ms} ms against a baseline of{' '}
                {data.regression.p95_base_ms} ms, {data.regression.regression_factor}× on{' '}
                {data.regression.affected_count} requests since{' '}
                {new Date(data.regression.first_detected_at).toLocaleString()}.
              </p>
            </div>
          )}

          <div>
            <p className="label-mono mb-2 text-muted-foreground">Spans</p>
            {data.spans.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No spans were recorded for this request.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {data.spans.map((span) => (
                  <li
                    key={span.span_id}
                    className="flex flex-wrap items-center gap-3 py-2 text-xs first:pt-0 last:pb-0"
                  >
                    {span.span_id === primaryId && (
                      <Pill label="blamed" color="var(--status-serious)" />
                    )}
                    <span className="font-mono">{span.name}</span>
                    <span className="text-muted-foreground">{span.kind}</span>
                    {span.status && span.status !== 'OK' && (
                      <span style={{ color: 'var(--status-warning)' }}>{span.status}</span>
                    )}
                    {span.db_statement && (
                      <code
                        className="max-w-md truncate rounded bg-muted px-1.5 py-0.5 font-mono"
                        title={span.db_statement}
                      >
                        {span.db_statement}
                      </code>
                    )}
                    <span className="ml-auto font-mono [font-variant-numeric:tabular-nums]">
                      {ms(span.duration_nanos)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {data.spans_truncated && (
              <p className="mt-2 text-xs text-muted-foreground">
                The span list was cut; this is the beginning of the trace.
              </p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Trace {data.request.trace_id ?? '—'} · deployment{' '}
            {data.request.deployment_id.slice(0, 8)} · generated{' '}
            {new Date(data.generated_at).toLocaleString()}
          </p>
        </div>
      )}
    </Modal>
  );
}
