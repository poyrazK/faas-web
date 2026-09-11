import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useDomainDoctor = vi.fn();
vi.mock('@/lib/api/queries', () => ({
  useDomainDoctor: (domain: string) => useDomainDoctor(domain) as unknown,
}));

const { DomainDoctor } = await import('./domain-doctor');

type Check = {
  name: string;
  status: string;
  detail: string;
  observed?: string;
  remediation?: string;
};

function report(checks: Check[], extra: Record<string, unknown> = {}) {
  return {
    data: {
      domain: 'app.example.com',
      app_id: 'a1',
      stale: false,
      healthy: checks.every((c) => c.status === 'ok'),
      observed_at: '2026-09-06T10:00:00Z',
      checks,
      ...extra,
    },
    isPending: false,
    error: null,
  };
}

const OK: Check = { name: 'dns_record', status: 'ok', detail: 'CNAME resolves' };

describe('DomainDoctor', () => {
  it('lists every check with its status', () => {
    useDomainDoctor.mockReturnValue(
      report([OK, { name: 'caa_permits', status: 'na', detail: 'No CAA record' }])
    );
    render(<DomainDoctor domain="app.example.com" />);
    expect(screen.getByText('dns_record')).toBeInTheDocument();
    expect(screen.getByText('caa_permits')).toBeInTheDocument();
    expect(screen.getByText('CNAME resolves')).toBeInTheDocument();
  });

  it('shows the remediation for a failing check', () => {
    useDomainDoctor.mockReturnValue(
      report([
        {
          name: 'points_to_gregale',
          status: 'fail',
          detail: 'CNAME does not point at Gregale',
          observed: 'wrong.example.com.',
          remediation: 'Set CNAME app.example.com → edge.gregale.dev',
        },
      ])
    );
    render(<DomainDoctor domain="app.example.com" />);
    expect(screen.getByText('Set CNAME app.example.com → edge.gregale.dev')).toBeInTheDocument();
    expect(screen.getByText('wrong.example.com.')).toBeInTheDocument();
  });

  it('says the reading is stale rather than hiding it', () => {
    useDomainDoctor.mockReturnValue(report([OK], { stale: true }));
    render(<DomainDoctor domain="app.example.com" />);
    expect(screen.getByText(/stale/i)).toBeInTheDocument();
  });

  it('reports an operator-disabled doctor as unavailable, not an error', () => {
    useDomainDoctor.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 503, code: 'doctor_disabled', title: 'Disabled' }),
    });
    render(<DomainDoctor domain="app.example.com" />);
    expect(screen.getByText(/not enabled/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not/i)).not.toBeInTheDocument();
  });

  it('surfaces a real failure as an error', () => {
    useDomainDoctor.mockReturnValue({
      data: undefined,
      isPending: false,
      error: new ApiError({ status: 500, code: 'internal', title: 'Boom' }),
    });
    render(<DomainDoctor domain="app.example.com" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
  });
});
