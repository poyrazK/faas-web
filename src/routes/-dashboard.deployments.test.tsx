import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useApps = vi.fn();
const useBuilds = vi.fn();
const useDeployment = vi.fn();
const useDeploymentScan = vi.fn();
const useDeploymentSecretScan = vi.fn();
const useInfiniteDeployments = vi.fn();
const fetchNextPage = vi.fn();
const refetchApps = vi.fn();
const refetchDeployments = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
  useNavigate: () => vi.fn(),
}));
vi.mock('@/lib/api/adapters', () => ({
  slugIndex: () => new Map(),
  toDeployment: () => ({
    id: 'dep-1',
    workflowId: 'alpha',
    state: 'succeeded',
    message: 'First deployment',
    version: 'sha256:aaaa',
    commit: 'abc123',
    createdAt: Date.parse('2026-09-09T10:00:00Z'),
    durationMs: 0,
  }),
}));
vi.mock('@/lib/api/queries', () => ({
  useApps: () => useApps() as unknown,
  useBuilds: () => useBuilds() as unknown,
  useDeployment: () => useDeployment() as unknown,
  useDeploymentScan: () => useDeploymentScan() as unknown,
  useDeploymentSecretScan: () => useDeploymentSecretScan() as unknown,
  useInfiniteDeployments: () => useInfiniteDeployments() as unknown,
  useUpdateDeploymentMinInstances: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDeploymentTraffic: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/dashboard/resource-table', () => ({
  Pill: () => null,
  ResourceTable: ({ error, onRetry }: { error?: unknown; onRetry: () => void }) =>
    error ? <button onClick={onRetry}>Retry</button> : null,
}));
vi.mock('@/components/ui/modal', () => ({ Modal: () => null }));

const { DeploymentsPage } = await import('./dashboard.deployments');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });

function infiniteQuery({ items, error }: { items: unknown[]; error: Error | null }) {
  return {
    data: { pages: [{ items }] },
    isPending: false,
    error,
    refetch: refetchDeployments,
    fetchNextPage,
    hasNextPage: true,
    isFetchingNextPage: false,
  };
}

beforeEach(() => {
  fetchNextPage.mockReset().mockResolvedValue(undefined);
  refetchApps.mockReset().mockResolvedValue(undefined);
  refetchDeployments.mockReset().mockResolvedValue(undefined);
  useApps.mockReset().mockReturnValue({ ...ready([]), refetch: refetchApps });
  useBuilds.mockReset().mockReturnValue(ready({ items: [] }));
  useDeployment.mockReset().mockReturnValue(ready(undefined));
  useDeploymentScan.mockReset().mockReturnValue(ready(undefined));
  useDeploymentSecretScan.mockReset().mockReturnValue(ready(undefined));
});

describe('DeploymentsPage pagination retries', () => {
  it('retries the failed next page without refetching loaded data', () => {
    useInfiniteDeployments.mockReturnValue(
      infiniteQuery({ items: [{}], error: new Error('next page failed') })
    );

    render(<DeploymentsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(fetchNextPage).toHaveBeenCalledTimes(1);
    expect(refetchDeployments).not.toHaveBeenCalled();
    expect(refetchApps).not.toHaveBeenCalled();
  });

  it('refetches apps and deployments when the initial load fails', () => {
    useInfiniteDeployments.mockReturnValue(
      infiniteQuery({ items: [], error: new Error('initial load failed') })
    );

    render(<DeploymentsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(refetchDeployments).toHaveBeenCalledTimes(1);
    expect(refetchApps).toHaveBeenCalledTimes(1);
    expect(fetchNextPage).not.toHaveBeenCalled();
  });
});
