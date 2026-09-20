import { Pill } from '@/components/dashboard/resource-table';
import { ApiError } from '@/lib/api/errors';
import { useDomainDoctor } from '@/lib/api/queries';
import { InlinePhase, queryPhase } from './primitives';

/**
 * The five-check domain doctor (ADR-120), displayed in the diagnostics dialog.
 *
 * The page already prints the TXT record and tells the customer to publish it;
 * this is the other half — what the platform actually observes once they have.
 * `remediation` is the field that earns the panel: it is the exact record to
 * change, so it is given its own line rather than folded into the detail text.
 *
 * Two states the contract makes explicit and this therefore does not flatten
 * into a generic error. `doctor_disabled` means the operator has not turned the
 * probe on — a deployment fact, not a failure of this domain, so it reads as
 * unavailable. `stale: true` means the cached observation was past its TTL and
 * the handler re-probed synchronously; saying so is more honest than showing a
 * fresh-looking timestamp.
 */

const STATUS_COLOR: Record<string, string> = {
  ok: 'var(--status-good)',
  fail: 'var(--status-critical)',
  pending: 'var(--status-warning)',
  na: 'var(--status-idle)',
};

/** Stable tokens from the API, spelled for people. */
const CHECK_LABEL: Record<string, string> = {
  dns_record: 'DNS record',
  points_to_gregale: 'Points to Gregale',
  tls_certificate: 'TLS certificate',
  caa_permits: 'CAA permits issuance',
  ipv6_conflict: 'IPv6 conflict',
};

function formatWhen(value: string | undefined): string {
  if (!value) return '';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '' : new Date(ms).toLocaleString();
}

export function DomainDoctor({ domain }: { domain: string }) {
  const { data, isPending, error, refetch } = useDomainDoctor(domain);

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Probing {domain}…</p>;
  }

  // Dark-launched or mid-outage: the probe is the thing that is missing, not
  // the domain. Either way there is nothing for the customer to fix.
  if (
    error instanceof ApiError &&
    (error.code === 'doctor_disabled' || error.code === 'doctor_unavailable')
  ) {
    return (
      <p className="text-sm text-muted-foreground">
        The domain doctor is not enabled on this deployment. DNS status is still available in the
        domains table.
      </p>
    );
  }

  if (error || !data) {
    return (
      <InlinePhase
        phase={queryPhase({ error: error ?? new Error('No domain diagnosis was returned.') })}
        error={error ?? new Error('No domain diagnosis was returned.')}
        onRetry={() => void refetch()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {data.stale
          ? 'Cached reading was stale, so this was re-probed just now.'
          : `Observed ${formatWhen(data.observed_at)}`}
      </p>

      <ul className="flex flex-col divide-y divide-border">
        {data.checks.map((check) => (
          <li key={check.name} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Pill label={check.status} color={STATUS_COLOR[check.status]} />
              <span className="font-mono text-xs">{check.name}</span>
              <span className="text-sm">{CHECK_LABEL[check.name] ?? check.name}</span>
            </div>

            <p className="text-sm text-muted-foreground">{check.detail}</p>

            {check.observed && (
              <p className="text-xs text-muted-foreground">
                Observed: <code className="select-all break-all">{check.observed}</code>
              </p>
            )}

            {check.remediation && (
              <p className="text-xs text-foreground">
                <span className="label-mono text-muted-foreground">Fix </span>
                <code className="select-all break-all">{check.remediation}</code>
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
