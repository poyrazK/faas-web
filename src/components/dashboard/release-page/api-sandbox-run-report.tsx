import type { APISandboxRunReport } from '@/lib/api/api-sandboxes';

export const sandboxRunStatus: Record<APISandboxRunReport['status'], string> = {
  queued: 'Preparing fresh sandbox',
  running: 'Running checks',
  awaiting_partner: 'Waiting for partner requests',
  awaiting_partner_outcome: 'Waiting for partner outcome',
  checking_state: 'Checking final state',
  passed: 'Passed',
  failed: 'Failed',
  interrupted: 'Interrupted',
};

const stepFailures: Record<string, string> = {
  invalid_request: 'The saved request could not be sent.',
  request_unavailable: 'The sandbox did not return a response.',
  deployment_mismatch: 'The response could not be attributed to the pinned deployment.',
  unexpected_http_status: 'The response status did not match the saved check.',
  invalid_json_response: 'The JSON response was invalid or exceeded the size limit.',
  webhook_fixture_unavailable: 'The sandbox could not prepare a signed Stripe fixture.',
  webhook_ingress_rejected: 'Webhook ingress rejected the test event.',
  webhook_receipt_unavailable: 'The test event returned no usable receipt.',
  webhook_duplicate_mismatch:
    'The original submission and duplicate did not match the expected receipt.',
  webhook_processing_unavailable: 'The accepted delivery could not be read.',
  webhook_processing_failed: 'The app did not process the accepted event successfully.',
  webhook_processing_timeout: 'The app did not finish processing before the delivery wait ended.',
  webhook_state_timeout: 'The final state did not match before the assertion wait ended.',
  outbound_webhook_unavailable: 'The sandbox could not create a temporary callback receiver.',
  outbound_job_rejected: 'The sandbox could not queue the async job.',
  outbound_job_unavailable: 'The accepted job could not be read.',
  outbound_job_failed: 'The async job failed before it queued a completion webhook.',
  outbound_job_timeout: 'The async job did not finish before the wait ended.',
  outbound_webhook_not_queued: 'The job finished without the expected callback.',
  outbound_webhook_delivery_unavailable: 'The callback attempt history could not be read.',
  outbound_webhook_delivery_timeout:
    'The expected callback attempt did not finish before the wait ended.',
  outbound_webhook_unexpected_attempt:
    'The receiver response or retry outcome did not match the scenario.',
  partner_receiver_unavailable: 'The partner receiver expired or could not be prepared.',
  partner_outcome_missing: 'The partner missed the deadline to report the outcome.',
  partner_outcome_mismatch:
    'The partner reported a count other than one committed business effect.',
  outbound_webhook_payload_mismatch:
    'The delivered callback result did not match the saved assertions.',
};

export function SandboxRunReportDetails({ run }: { run: APISandboxRunReport }) {
  const failedStep = run.steps.some((step) => step.failure_code);
  return (
    <div className="grid gap-3 text-sm">
      <p className="break-all text-xs text-muted-foreground">
        Scenario revision <code>{run.scenario_revision}</code>
      </p>
      {run.mode === 'partner' ? (
        <p className="text-xs text-muted-foreground">
          {run.steps.filter((step) => step.partner_request && !step.failure_code).length} of{' '}
          {run.partner_step_count} partner requests passed
        </p>
      ) : null}
      {run.partner_webhook ? (
        <p className="text-xs text-muted-foreground">
          Gregale recorded the callback attempts from its delivery ledger. The business-effect count
          comes from the partner.
        </p>
      ) : null}
      {run.status === 'awaiting_partner_outcome' && run.partner_outcome_until ? (
        <p className="text-xs text-muted-foreground">
          Outcome due{' '}
          <time dateTime={run.partner_outcome_until}>
            {new Date(run.partner_outcome_until).toLocaleString()}
          </time>
        </p>
      ) : null}
      {run.status === 'interrupted' ? (
        <p role="status">The run stopped early. Start a new run to retry on a fresh database.</p>
      ) : run.status === 'failed' && !failedStep ? (
        <p role="status">
          {run.failure_code === 'partner_requests_missing'
            ? 'The sandbox closed before the partner completed the saved requests.'
            : run.failure_code === 'run_credentials_unavailable'
              ? 'The sandbox could not issue a temporary run key.'
              : 'The sandbox could not be prepared for this run.'}
        </p>
      ) : null}
      {run.steps.length ? (
        <ol className="grid list-decimal gap-3 pl-5">
          {run.steps.map((step) => (
            <li key={step.index} className="space-y-1">
              <p className="font-medium">
                {step.title} · {step.failure_code ? 'Failed' : 'Passed'}
              </p>
              <p className="text-xs text-muted-foreground">
                {step.method}
                {step.path ? (
                  <>
                    {' '}
                    <code className="break-all">{step.path}</code>
                  </>
                ) : null}
                {run.mode === 'partner'
                  ? step.partner_request
                    ? ' · Partner request'
                    : ' · Final state check'
                  : ''}
                {step.event_type ? (
                  <>
                    {' '}
                    · <code className="break-all">{step.event_type}</code>
                  </>
                ) : null}
                {step.expected_status ? ` · Expected HTTP ${step.expected_status}` : ''}
                {step.http_status ? ` · Received HTTP ${step.http_status}` : ''}
                {' · '}
                {step.duration_ms} ms
              </p>
              {step.failed_assertion ? (
                <p className="text-xs text-destructive">
                  JSON assertion {step.failed_assertion} failed
                  {step.failed_pointer ? (
                    <>
                      {' '}
                      at <code>{step.failed_pointer}</code>
                    </>
                  ) : null}
                  {step.failure_code === 'webhook_state_timeout' ? ' before the wait ended.' : '.'}
                </p>
              ) : step.failure_code ? (
                <p className="text-xs text-destructive">
                  {stepFailures[step.failure_code] ?? 'This check stopped early.'}
                </p>
              ) : null}
              {step.invocation_id ? (
                <p className="break-all text-xs text-muted-foreground">
                  Receipt ID <code>{step.invocation_id}</code>
                  {step.invocation_state ? ` · ${step.invocation_state.replaceAll('_', ' ')}` : ''}
                  {step.delivery_attempts ? ` · Attempts ${step.delivery_attempts}` : ''}
                </p>
              ) : null}
              {step.delivery_id ? (
                <p className="break-all text-xs text-muted-foreground">
                  Delivery ID <code>{step.delivery_id}</code>
                  {step.attempt_number ? ` · Attempt ${step.attempt_number}` : ''}
                </p>
              ) : null}
              {step.acknowledgement_dropped ? (
                <p className="text-xs text-muted-foreground">
                  Gregale received a successful response and intentionally retried this delivery.
                </p>
              ) : null}
              {typeof step.partner_applied_count === 'number' ? (
                <p className="text-xs text-muted-foreground">
                  Partner-reported committed effects · {step.partner_applied_count}
                </p>
              ) : null}
              {step.observed_at ? (
                <time className="block text-xs text-muted-foreground" dateTime={step.observed_at}>
                  {new Date(step.observed_at).toLocaleString()}
                </time>
              ) : null}
              {step.request_id ? (
                <p className="break-all text-xs text-muted-foreground">
                  Request ID <code>{step.request_id}</code>
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
