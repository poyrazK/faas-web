import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ReleaseScans } from './release-evidence';

const scan = vi.hoisted(() => vi.fn());

beforeEach(() => scan.mockReset());

vi.mock('@/lib/api/queries', () => ({
  useDeploymentScan: () =>
    scan() ?? {
      data: { status: 'pending', vulnerabilities: [] },
      isPending: false,
      error: null,
    },
  useDeploymentSecretScan: () => ({
    data: { status: 'error', error: 'Audit row could not be decoded', findings: [] },
    isPending: false,
    error: null,
  }),
}));

it('shows incomplete and unreadable scan evidence without claiming the image is clean', () => {
  render(<ReleaseScans deploymentId="dep-1" />);
  expect(screen.getByText('Scan pending.')).toBeInTheDocument();
  expect(screen.getByText(/Audit row could not be decoded/)).toBeInTheDocument();
  expect(screen.queryByText(/No secrets found/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Nothing known in this image/)).not.toBeInTheDocument();
});

it('distinguishes critical, high and medium vulnerability severities', () => {
  scan.mockReturnValue({
    data: {
      status: 'complete',
      vulnerabilities: ['CRITICAL', 'HIGH', 'MEDIUM'].map((severity) => ({
        id: `CVE-${severity}`,
        severity,
        package: 'openssl',
        version: '1',
      })),
    },
    isPending: false,
    error: null,
  });
  render(<ReleaseScans deploymentId="dep-1" />);
  expect(screen.getByText('critical')).toHaveStyle({ color: 'var(--status-critical)' });
  expect(screen.getByText('high')).toHaveStyle({ color: 'var(--status-serious)' });
  expect(screen.getByText('medium')).toHaveStyle({ color: 'var(--status-warning)' });
});
