import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useCopy } from '@/components/ui/copy-button';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useDebugRequestEvidence, useDeployment } from '@/lib/api/queries';
import { safeDebugBundle, suggestedDebugChecks } from './debug-support';
import { regressionKey } from './debug-search';
import { DebugGate } from './debug-gate';

/**
 * One request, in full: the telemetry row, the spans the gateway recorded
 * under it, and the platform's own explanation (ADR-127).
 *
 * `explanation.status` is the API's verdict — `regression_detected` when it
 * matched this request to a known regression, `unobserved` when it has
 * nothing to compare against. The headline is the platform's sentence, shown
 * as written rather than re-worded, and `primary_span` is the span it blames.
 * The API returns durations and parent IDs, but no start offsets. Bars show
 * relative duration, never inferred chronology or overlap.
 */

function ms(nanos: number): string {
  const value = nanos / 1_000_000;
  return value < 1 ? `${value.toFixed(2)} ms` : `${Math.round(value)} ms`;
}

export function DebugRequestEvidence({
  slug,
  reqId,
  onClose,
  onRegression,
}: {
  slug: string;
  reqId: string | null;
  onClose: () => void;
  onRegression?: (key: string) => void;
}) {
  const evidence = useDebugRequestEvidence(slug, reqId ?? '');
  const data = evidence.data;
  const deployment = useDeployment(data?.request.deployment_id ?? '');
  const buildId =
    deployment.data?.id === data?.request.deployment_id ? deployment.data?.build_id : undefined;
  const { copied, copy } = useCopy();
  const [copyError, setCopyError] = useState(false);
  const missing = evidence.error instanceof ApiError && evidence.error.code === 'not_found';
  const primaryId = data?.explanation.primary_span?.span_id;
  const maximum = Math.max(
    1,
    ...(data?.spans ?? []).map((span) =>
      Number.isFinite(span.duration_nanos) ? Math.max(0, span.duration_nanos) : 0
    )
  );

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
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        <DebugGate error={evidence.error}>
          {evidence.isPending ? (
            <p className="text-sm text-muted-foreground">Collecting the evidence…</p>
          ) : missing ? (
            <p className="text-sm text-muted-foreground">
              No telemetry is kept for this request any more.
            </p>
          ) : evidence.error || !data ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-muted-foreground">
                {evidence.error
                  ? errorMessage(evidence.error)
                  : 'No evidence was returned for this request.'}
              </p>
              <Button size="xs" variant="outline" onClick={() => void evidence.refetch()}>
                Retry evidence
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">What happened</h3>
                <p className="text-sm">
                  {data.request.method} <code>{data.request.route}</code> returned{' '}
                  {data.request.status} in {data.request.latency_ms} ms.
                </p>
                <dl className="grid gap-3 text-xs sm:grid-cols-2">
                  {[
                    ['App', slug],
                    ['Request', data.request.id],
                    ['Release / deployment', data.request.deployment_id || 'Not reported'],
                    [
                      'Build',
                      buildId ||
                        (deployment.isPending
                          ? 'Loading build context…'
                          : deployment.error
                            ? 'Build context unavailable'
                            : 'Not reported'),
                    ],
                    ['Trace', data.request.trace_id || 'Not reported'],
                    ['Received', data.request.received_at],
                    ['Requests represented', data.request.count],
                    [
                      'Cold start',
                      data.request.cold_boot === true
                        ? 'Recorded'
                        : data.request.cold_boot === false
                          ? 'Not recorded'
                          : 'Not reported',
                    ],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="mt-1 break-words font-mono">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-muted-foreground">
                  Wake and instance IDs were not returned for this request.
                </p>
              </section>
              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">Why</h3>
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill
                      label={
                        data.explanation.status === 'regression_detected'
                          ? 'regression'
                          : 'unobserved'
                      }
                      color={
                        data.explanation.status === 'regression_detected'
                          ? 'var(--status-serious)'
                          : 'var(--status-idle)'
                      }
                    />
                    {data.request.cold_boot && (
                      <Pill label="cold boot" color="var(--status-warning)" />
                    )}
                  </div>
                  <p className="text-sm">
                    {data.explanation.headline ||
                      'No deterministic explanation is available for this request.'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Explanation from recorded platform evidence. Unobserved means no comparison
                    verdict is available.
                  </p>
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
                    {onRegression && (
                      <Button
                        size="xs"
                        variant="ghost"
                        className="mt-2"
                        onClick={() => onRegression(regressionKey(data.regression!))}
                      >
                        Inspect matched regression
                      </Button>
                    )}
                  </div>
                )}

                <div>
                  <h4 className="label-mono mb-2 text-muted-foreground">Span duration waterfall</h4>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Relative durations, in returned order. Start offsets and overlap are not
                    returned; bars share a duration scale and do not show chronology.
                  </p>
                  {data.spans.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No spans were recorded for this request.
                    </p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-border">
                      {data.spans.map((span) => (
                        <li
                          key={span.span_id}
                          className="flex flex-col gap-2 py-2 text-xs first:pt-0 last:pb-0"
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            {span.span_id === primaryId && (
                              <Pill label="blamed" color="var(--status-serious)" />
                            )}
                            <span className="font-mono">{span.name}</span>
                            <span className="text-muted-foreground">{span.kind}</span>
                            {span.status && span.status !== 'OK' && (
                              <span style={{ color: 'var(--status-warning)' }}>{span.status}</span>
                            )}
                            <span className="ml-auto font-mono [font-variant-numeric:tabular-nums]">
                              {Number.isFinite(span.duration_nanos) && span.duration_nanos >= 0
                                ? ms(span.duration_nanos)
                                : 'Duration not reported'}
                            </span>
                          </div>
                          {span.parent_span_id && (
                            <span className="text-muted-foreground">
                              Parent span: {span.parent_span_id}
                            </span>
                          )}
                          <div className="h-2 rounded bg-muted">
                            <div
                              role="img"
                              aria-label={`${span.name}: ${ms(span.duration_nanos)} relative duration`}
                              className="h-full rounded"
                              style={{
                                width: `${Number.isFinite(span.duration_nanos) ? (Math.max(0, span.duration_nanos) / maximum) * 100 : 0}%`,
                                backgroundColor:
                                  span.span_id === primaryId
                                    ? 'var(--status-serious)'
                                    : 'var(--chart-muted)',
                              }}
                            />
                          </div>
                          {span.db_statement && (
                            <code
                              className="block truncate rounded bg-muted px-1.5 py-0.5 font-mono"
                              title={span.db_statement}
                            >
                              {span.db_statement}
                            </code>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {data.spans_truncated && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      The span list was cut; this is partial evidence.
                    </p>
                  )}
                </div>
              </section>
              <section className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold">What to inspect next</h3>
                {suggestedDebugChecks(data).map((check) => (
                  <p key={check} className="text-xs text-muted-foreground">
                    {check}
                  </p>
                ))}
                <nav
                  aria-label="Request context"
                  className="flex flex-wrap gap-4 text-sm underline underline-offset-4"
                >
                  <a href={`/dashboard/workflows/${encodeURIComponent(slug)}`}>Open app</a>
                  {data.request.deployment_id && (
                    <a
                      href={`/dashboard/deployments?${new URLSearchParams({ deployment: data.request.deployment_id })}`}
                    >
                      Open release
                    </a>
                  )}
                  {buildId && (
                    <a
                      href={`/dashboard/deployments?${new URLSearchParams({ view: 'builds', build: buildId })}`}
                    >
                      Open build
                    </a>
                  )}
                  <a href={`/dashboard/logs?${new URLSearchParams({ app: slug })}`}>App logs</a>
                  <a href="/dashboard/traces">Browse invocations</a>
                  <a href="/dashboard/workers">Browse instances</a>
                </nav>
                <p className="text-xs text-muted-foreground">
                  Logs open for this app. Invocations and instances open their lists; request, trace
                  and time filters are not supported by those links.
                </p>
                <Button
                  className="self-start"
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    setCopyError(false);
                    setCopyError(!(await copy(safeDebugBundle(slug, data, buildId))));
                  }}
                >
                  Copy safe support bundle
                </Button>
                <p className="text-xs text-muted-foreground">
                  Copies bounded identifiers, status, timings and deterministic evidence. Excludes
                  headers, bodies, credentials, SQL and free-form payloads.
                </p>
                <p aria-live="polite" className="text-xs">
                  {copyError
                    ? 'Could not copy. Check clipboard access and try again.'
                    : copied
                      ? 'Support bundle copied'
                      : ''}
                </p>
              </section>
              <p className="text-xs text-muted-foreground">
                Evidence generated: {data.generated_at || 'Not reported'}
              </p>
            </div>
          )}
        </DebugGate>
      </div>
    </Modal>
  );
}
