import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DoctorReport } from './domain-doctor';
import type { components } from '@/lib/api/schema';

const report: components['schemas']['DomainDoctorReport'] = {
  domain: 'app.example.com',
  app_id: '0123456789abcdef0123456789abcdef',
  stale: false,
  observed_at: '2026-08-18T14:23:11Z',
  healthy: false,
  checks: [
    { name: 'dns_record', status: 'ok', detail: 'CNAME found' },
    {
      name: 'points_to_gregale',
      status: 'fail',
      detail: 'CNAME does not point at Gregale (observed: wrong.example.com.)',
      observed: 'wrong.example.com.',
      remediation: 'Set CNAME app.example.com → edge.gregale.dev',
    },
    { name: 'tls_certificate', status: 'pending', detail: 'Waiting for DNS' },
    { name: 'caa_permits', status: 'ok', detail: 'No CAA restriction' },
    { name: 'ipv6_conflict', status: 'na', detail: 'No AAAA record' },
  ],
};

/**
 * The report is the whole reason for the doctor: five named checks, and for
 * the one that fails, the exact record to change.
 */
describe('DoctorReport', () => {
  it('lists the five checks with their status and the fix for the failing one', () => {
    render(<DoctorReport report={report} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText('Points to Gregale')).toBeInTheDocument();
    expect(screen.getByText('Set CNAME app.example.com → edge.gregale.dev')).toBeInTheDocument();
    expect(screen.getByText(/unhealthy/i)).toBeInTheDocument();
  });
});
