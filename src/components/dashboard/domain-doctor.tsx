import type { components } from '@/lib/api/schema';
import { Pill } from '@/components/dashboard/resource-table';

type Report = components['schemas']['DomainDoctorReport'];
type Check = components['schemas']['DomainDoctorCheck'];

/** The check names as the user reads them; the tokens are the API's. */
const LABEL: Record<Check['name'], string> = {
  dns_record: 'DNS record',
  points_to_gregale: 'Points to Gregale',
  tls_certificate: 'TLS certificate',
  caa_permits: 'CAA permits issuance',
  ipv6_conflict: 'IPv6 conflict',
};

const COLOR: Record<Check['status'], string> = {
  ok: 'var(--status-good)',
  fail: 'var(--status-critical)',
  pending: 'var(--status-warning)',
  na: 'var(--muted-foreground)',
};

/**
 * One domain's doctor report: five checks, and for each failing one the
 * exact record to change. The remediation line is the point of the page —
 * a domain that never verifies is the platform's biggest activation
 * drop-off, and "pending" alone never told anyone what to fix.
 */
export function DoctorReport({ report }: { report: Report }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {report.healthy ? 'Healthy' : 'Unhealthy'} · checked{' '}
        {new Date(report.observed_at).toLocaleString()}
        {report.stale ? ' · re-probed just now' : ''}
      </p>
      <ul className="flex flex-col divide-y divide-border">
        {report.checks.map((c) => (
          <li key={c.name} className="flex flex-col gap-1 py-2.5">
            <div className="flex items-center gap-3">
              <Pill label={c.status} color={COLOR[c.status]} />
              <span className="text-sm font-medium">{LABEL[c.name]}</span>
            </div>
            <p className="text-xs text-muted-foreground">{c.detail}</p>
            {c.status === 'fail' && c.remediation && (
              <code className="select-all break-all rounded-md bg-muted px-2 py-1 font-mono text-xs">
                {c.remediation}
              </code>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
