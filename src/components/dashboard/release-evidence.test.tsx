import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ReleaseScans } from './release-evidence';

vi.mock('@/lib/api/queries', () => ({
  useDeploymentScan: () => ({
    data: { status: 'pending', vulnerabilities: [] },
    isPending: false,
    error: null,
  }),
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
