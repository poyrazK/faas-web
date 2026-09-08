import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useObjectStorageUsage = vi.fn();
vi.mock('@/lib/api/object-storage', () => ({
  useObjectStorageUsage: () => useObjectStorageUsage() as unknown,
}));

const { ObjectStorageUsagePanel } = await import('./object-storage-usage');

beforeEach(() => {
  useObjectStorageUsage.mockReset().mockReturnValue({
    data: {
      usage: {
        observed_bytes: 41_237_899_264,
        capacity_bytes: 214_748_364_800,
        capacity_keys: 500_000,
        stored_byte_hours: 1,
        request_count: 184_221,
        egress_bytes: 8_912_345_600,
        cost_millicents: 412_800,
        authorizations: 9_412,
        fresh: true,
        period_start: '2026-09-01T00:00:00Z',
      },
      policy: {
        max_account_bytes: 214_748_364_800,
        max_bucket_bytes: 107_374_182_400,
        max_account_keys: 500_000,
        max_monthly_cost_millicents: 5_000_000,
        max_monthly_requests: 5_000_000,
        max_monthly_egress_bytes: 1_099_511_627_776,
        max_monthly_authorizations: 250_000,
        max_report_age_seconds: 3600,
      },
      charges: {
        currency: 'USD',
        storage_millicents: 268_400,
        requests_millicents: 61_200,
        egress_millicents: 83_200,
        total_millicents: 412_800,
      },
    },
    isPending: false,
    error: null,
  });
});

describe('ObjectStorageUsagePanel', () => {
  it('shows stored bytes against the policy cap and the cost so far', () => {
    render(<ObjectStorageUsagePanel />);
    expect(screen.getByText('38 GB')).toBeInTheDocument();
    expect(screen.getByText('19% of 200 GB')).toBeInTheDocument();
    expect(screen.getByText('$4.128')).toBeInTheDocument();
  });

  it('says so when the report is stale rather than presenting it as current', () => {
    const current = useObjectStorageUsage();
    useObjectStorageUsage.mockReturnValue({
      ...current,
      data: { ...current.data, usage: { ...current.data.usage, fresh: false } },
    });
    render(<ObjectStorageUsagePanel />);
    expect(screen.getByText(/last report is stale/i)).toBeInTheDocument();
  });
});
