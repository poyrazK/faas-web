import type { ReactNode } from 'react';
import { CheckCircle, Clock, Prohibition, WarningTriangle } from 'iconoir-react';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import type { DebugRequestEvidence } from '@/lib/api/queries';

/*
 * The parts of a request's evidence beyond its row and spans
 * (GET .../debug/requests/{req_id}/evidence, faas ADR-127,
 * handlers_debug_evidence.go): the deterministic request and wake timeline,
 * the edge-to-billing correlation, the reconstructed critical path, the
 * dependency groups and their split by deployment, the request's own log
 * lines, guest execution, and the rules-based findings and recommendations.
 *
 * Every field is rendered as the API returned it. A stage the API marks
 * missing or partial says so; nothing is drawn as zero that was not measured.
 */

type Evidence = DebugRequestEvidence;

const PHASE_LABEL: Record<Evidence['timeline'][number]['phase'], string> = {
  request: 'Request',
  wake: 'Wake',
  guest: 'Guest',
  error: 'Error',
  regression: 'Regression',
};

const STAGE_LABEL: Record<Evidence['correlation']['stages'][number]['phase'], string> = {
  edge: 'Edge',
  queue: 'Queue',
  wake: 'Wake',
  guest: 'Guest',
  downstream: 'Downstream',
  billing: 'Billing',
};

const STAGE_STATUS: Record<
  Evidence['correlation']['stages'][number]['status'],
  { label: string; color: string; icon: typeof CheckCircle }
> = {
  observed: { label: 'Observed', color: 'var(--status-good)', icon: CheckCircle },
  partial: { label: 'Partial', color: 'var(--status-warning)', icon: WarningTriangle },
  missing: { label: 'Missing', color: 'var(--status-critical)', icon: WarningTriangle },
  not_applicable: { label: 'Not applicable', color: 'var(--chart-muted)', icon: Prohibition },
};

const DIAGNOSIS: Record<NonNullable<Evidence['explanation']['diagnosis']>, string> = {
  dependency_failure: 'Dependency failure',
  request_failure: 'Request failure',
  dependency_regression: 'Dependency regression',
  error_regression: 'Error regression',
  performance_regression: 'Performance regression',
  cold_start: 'Cold start',
  slow_path: 'Slow path',
  insufficient_evidence: 'Insufficient evidence',
  no_issue_observed: 'No issue observed',
};

const OUTCOME: Record<NonNullable<Evidence['request']['guest']>['outcome'], string> = {
  ok: 'Completed',
  http_error: 'HTTP error',
  handler_error: 'Handler error',
  timeout: 'Timed out',
  canceled: 'Cancelled',
};

/** Colour, icon and label, so a state never rests on hue alone. */
export function EvidenceChip({
  label,
  color,
  icon: Icon,
}: {
  label: string;
  color: string;
  icon: typeof CheckCircle;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, color }}
    >
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h4 className="label-mono text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

const ms = (value: number | undefined) => (value === undefined ? '—' : `${value} ms`);

/** Identity and placement the request row carries beyond its route and status. */
export function EvidenceIdentity({ request }: { request: Evidence['request'] }) {
  const rows: [string, ReactNode][] = [];
  if (request.request_id)
    rows.push([
      'x-faas-request-id',
      <CopyableId key="r" value={request.request_id} label="request ID" full />,
    ]);
  if (request.instance_id)
    rows.push(['Instance', <CopyableId key="i" value={request.instance_id} label="instance ID" />]);
  if (request.node_id) rows.push(['Node', request.node_id]);
  if (request.commit_sha)
    rows.push(['Commit', <CopyableId key="c" value={request.commit_sha} label="commit" />]);
  if (request.deployment_tag) rows.push(['Deployment tag', request.deployment_tag]);
  if (request.image_digest)
    rows.push(['Image', <CopyableId key="d" value={request.image_digest} label="image digest" />]);
  if (request.consumer_id)
    rows.push([
      'API consumer',
      <CopyableId key="k" value={request.consumer_id} label="consumer ID" />,
    ]);
  if (request.guest)
    rows.push([
      'Guest execution',
      `${request.guest.runtime} · ${OUTCOME[request.guest.outcome]}${request.guest.error_class ? ` (${request.guest.error_class})` : ''} · ${request.guest.duration_ms} ms`,
    ]);
  return (
    <div className="flex flex-col gap-2">
      {request.evidence_status === 'request_id_only' && (
        <p role="note" className="text-xs" style={{ color: 'var(--status-warning)' }}>
          Only the request ID was kept for this request; its detailed request data was not sampled,
          so timings, spans and logs are absent rather than zero.
        </p>
      )}
      {rows.length > 0 && (
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="mt-1 min-w-0 break-words font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {request.trace_inferred && (
        <p className="text-xs text-muted-foreground">
          The trace ID is inferred: the caller sent no traceparent and was serving exactly one
          request, so Gregale linked the two.
        </p>
      )}
    </div>
  );
}

export function EvidenceFindings({ explanation }: { explanation: Evidence['explanation'] }) {
  const findings = explanation.findings ?? [];
  const recommendations = explanation.recommendations ?? [];
  const refs = explanation.evidence_refs ?? [];
  if (!explanation.diagnosis && !findings.length && !recommendations.length) return null;
  return (
    <div className="flex flex-col gap-3 text-xs">
      {explanation.diagnosis && (
        <p>
          <span className="text-muted-foreground">Diagnosis</span>{' '}
          <span className="font-medium">{DIAGNOSIS[explanation.diagnosis]}</span>
          {explanation.confidence && (
            <span className="text-muted-foreground"> · {explanation.confidence} confidence</span>
          )}
          {explanation.generated_by && (
            <span className="text-muted-foreground"> · {explanation.generated_by}</span>
          )}
        </p>
      )}
      {findings.length > 0 && (
        <ul aria-label="Findings" className="flex flex-col gap-2">
          {findings.map((finding) => (
            <li key={finding.code} className="rounded-md border border-border px-2.5 py-2">
              <p className="font-medium">
                {finding.title}{' '}
                <span className="font-normal text-muted-foreground">
                  · {finding.confidence} confidence
                </span>
              </p>
              <p className="mt-0.5 text-muted-foreground">{finding.detail}</p>
            </li>
          ))}
        </ul>
      )}
      {refs.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1">
          {refs.map((ref) => (
            <div key={`${ref.kind}:${ref.label}`} className="flex gap-1">
              <dt className="text-muted-foreground">{ref.label}</dt>
              <dd className="font-mono">{ref.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {recommendations.length > 0 && (
        <ul aria-label="Recommendations" className="flex list-disc flex-col gap-1 pl-4">
          {recommendations.map((rec) => (
            <li key={rec.action}>{rec.detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function EvidenceTimeline({ timeline }: { timeline: Evidence['timeline'] }) {
  return (
    <Section title="Timeline">
      {timeline.length === 0 ? (
        <p className="text-xs text-muted-foreground">No lifecycle markers were retained.</p>
      ) : (
        <ol className="flex flex-col gap-1.5 border-l border-border pl-3 text-xs">
          {timeline.map((event, i) => (
            <li key={`${event.at}:${event.kind}:${i}`} className="flex flex-wrap gap-x-2 gap-y-0.5">
              <Timestamp
                value={event.at}
                mode="absolute"
                className="font-mono text-muted-foreground"
              />
              <span className="font-medium">{PHASE_LABEL[event.phase]}</span>
              <span>{event.summary}</span>
              {event.duration_ms !== undefined && (
                <span className="text-muted-foreground">{event.duration_ms} ms</span>
              )}
              {event.status !== undefined && (
                <span className="text-muted-foreground">HTTP {event.status}</span>
              )}
              {event.approximate && (
                <span className="text-muted-foreground">(approximate: from a minute bucket)</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

export function EvidenceCorrelation({ correlation }: { correlation: Evidence['correlation'] }) {
  return (
    <Section title="Edge to billing">
      <p className="text-xs text-muted-foreground">
        {correlation.complete
          ? 'Every applicable stage has a complete saved record.'
          : 'Some stages are partial or missing; their time is unknown, not zero.'}
      </p>
      <ul className="grid gap-2 text-xs sm:grid-cols-2">
        {correlation.stages.map((stage) => (
          <li
            key={stage.phase}
            className="flex flex-col gap-1 rounded-md border border-border px-2.5 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{STAGE_LABEL[stage.phase]}</span>
              <EvidenceChip {...STAGE_STATUS[stage.status]} />
              {stage.duration_ms !== undefined && stage.status !== 'missing' && (
                <span className="ml-auto font-mono">
                  {stage.approximate ? '≈ ' : ''}
                  {stage.duration_ms} ms
                </span>
              )}
            </div>
            {stage.reason && <p className="text-muted-foreground">{stage.reason}</p>}
            {stage.evidence_count !== undefined && (
              <p className="text-muted-foreground">
                {stage.evidence_count} signal{stage.evidence_count === 1 ? '' : 's'}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Offsets come from the API's span start and end times; nothing is placed without them. */
export function EvidenceCriticalPath({ path }: { path: NonNullable<Evidence['critical_path']> }) {
  const starts = path.spans.map((s) => Date.parse(s.start_time));
  const ends = path.spans.map((s) => Date.parse(s.end_time));
  const origin = Math.min(...starts);
  const span = Math.max(1, Math.max(...ends) - origin);
  const timed = starts.every(Number.isFinite) && ends.every(Number.isFinite);
  return (
    <Section title="Critical path">
      <p className="text-xs text-muted-foreground">
        {path.duration_ms} ms across {path.span_count} span{path.span_count === 1 ? '' : 's'}
        {path.slowest_span_name &&
          `; the most time of its own is in ${path.slowest_span_name}${path.slowest_exclusive_ms !== undefined ? ` (${path.slowest_exclusive_ms} ms)` : ''}`}
        .{' '}
        {path.complete
          ? 'Every retained span had valid timing and parents.'
          : 'Some retained spans lacked timing or parents, so the path may be incomplete.'}
      </p>
      <ul className="flex flex-col gap-1.5 text-xs">
        {path.spans.map((s, i) => (
          <li key={s.span_id} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-2">
              <span className="min-w-0 truncate font-mono" title={s.name}>
                {s.name}
              </span>
              {s.dependency_name && (
                <span className="text-muted-foreground">{s.dependency_name}</span>
              )}
              <span className="ml-auto font-mono [font-variant-numeric:tabular-nums]">
                {s.duration_ms} ms · own {s.exclusive_ms} ms
              </span>
            </div>
            {timed && (
              <div className="relative h-2 rounded bg-muted">
                <div
                  role="img"
                  aria-label={`${s.name}: starts at ${starts[i] - origin} ms, lasts ${s.duration_ms} ms`}
                  className="absolute inset-y-0 rounded"
                  style={{
                    left: `${((starts[i] - origin) / span) * 100}%`,
                    width: `${Math.max(0.5, ((ends[i] - starts[i]) / span) * 100)}%`,
                    backgroundColor:
                      s.span_id === path.slowest_span_id
                        ? 'var(--status-serious)'
                        : 'var(--chart-muted)',
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function EvidenceDependencies({ data }: { data: Evidence }) {
  const groups = data.dependency_latency ?? [];
  const comparison = data.dependency_comparison;
  if (groups.length === 0 && !comparison) return null;
  return (
    <Section title="Dependencies on this request">
      {groups.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-left text-xs">
            <caption className="sr-only">Dependency calls made by this request</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-normal">Dependency</th>
                <th className="py-1 pr-3 text-right font-normal">Calls</th>
                <th className="py-1 pr-3 text-right font-normal">Errors</th>
                <th className="py-1 pr-3 text-right font-normal">Total</th>
                <th className="py-1 text-right font-normal">Slowest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groups.map((g) => (
                <tr key={`${g.type}:${g.kind ?? ''}:${g.name}`}>
                  <td className="py-1 pr-3">
                    <span className="font-mono">{g.name}</span>{' '}
                    <span className="text-muted-foreground">
                      {g.kind ?? g.type.replaceAll('_', ' ')}
                    </span>
                  </td>
                  <td className="py-1 pr-3 text-right font-mono">{g.calls}</td>
                  <td className="py-1 pr-3 text-right font-mono">{g.errors ?? 0}</td>
                  <td className="py-1 pr-3 text-right font-mono">{ms(g.total_duration_ms)}</td>
                  <td className="py-1 text-right font-mono">{ms(g.max_duration_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        A group&apos;s total can include overlapping calls, so it is not a share of the request.
        {data.dependency_latency_truncated &&
          ' More than 16 groups were retained; these are the first.'}
      </p>
      {comparison && comparison.dependencies.length > 0 && (
        <div className="flex flex-col gap-1.5 text-xs">
          <p className="text-muted-foreground">
            p95 by deployment:{' '}
            {comparison.previous_deployment_tag || comparison.previous_deployment_id.slice(0, 8)} →{' '}
            {comparison.current_deployment_tag || comparison.current_deployment_id.slice(0, 8)}
            {comparison.route ? ` on ${comparison.route}` : ''}.
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {comparison.dependencies.map((d) => (
              <li
                key={`${d.type}:${d.kind ?? ''}:${d.name}`}
                className="flex flex-wrap gap-x-2 py-1"
              >
                <span className="font-mono">{d.name}</span>
                <span className="ml-auto font-mono">
                  {ms(d.baseline_p95_ms)} → {ms(d.current_p95_ms)}
                </span>
                {(d.regression || d.failure_regression) && (
                  <EvidenceChip
                    label={d.failure_regression ? 'More failures' : 'Slower'}
                    color="var(--status-serious)"
                    icon={WarningTriangle}
                  />
                )}
              </li>
            ))}
          </ul>
          {comparison.truncated && (
            <p className="text-muted-foreground">The comparison was cut at 50 dependencies.</p>
          )}
        </div>
      )}
    </Section>
  );
}

export function EvidenceLogs({ data }: { data: Evidence }) {
  if (!data.logs) return null;
  return (
    <Section title="Logs from this request">
      {data.logs.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No log lines were attached. They come from OTel log records carrying this request&apos;s
          trace ID, so they need tracing on and an app that exports logs.
        </p>
      ) : (
        <ol className="flex flex-col gap-0.5 rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
          {data.logs.map((line, i) => (
            <li key={`${line.occurred_at}:${i}`} className="flex gap-2">
              <Clock aria-hidden className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
              <Timestamp
                value={line.occurred_at}
                mode="absolute"
                className="shrink-0 text-muted-foreground"
              />
              {line.level && <span className="shrink-0 uppercase">{line.level}</span>}
              <span className="min-w-0 whitespace-pre-wrap break-all">{line.message}</span>
            </li>
          ))}
        </ol>
      )}
      {data.logs_truncated && (
        <p className="text-xs text-muted-foreground">
          The request logged more than 20 lines; these are its last 20.
        </p>
      )}
    </Section>
  );
}
