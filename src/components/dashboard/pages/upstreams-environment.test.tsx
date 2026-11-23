import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ list: [] as unknown[][], add: [] as unknown[][] }));
vi.mock('@/lib/api/queries', () => ({
  useUpstreams: (...args: unknown[]) => {
    calls.list.push(args);
    return {
      data: {
        upstreams: [
          {
            id: 'u1',
            source: 'explicit',
            kind: 'postgres',
            host_redacted_hash: 'abcd',
            host_last4: 'b.io',
            port: 5432,
            scope: 'default',
            deployment_scope: 'staging',
            created_at: '2026-11-01T00:00:00Z',
          },
        ],
      },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    };
  },
  useAddUpstream: (...args: unknown[]) => {
    calls.add.push(args);
    return { mutateAsync: vi.fn(), isPending: false };
  },
  useDeleteUpstream: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/upstream-history', () => ({ UpstreamHistoryPanel: () => null }));

const { UpstreamsBody } = await import('./upstreams');

beforeEach(() => {
  calls.list.length = 0;
  calls.add.length = 0;
});

it('in Staging reads and declares Staging’s upstreams, and says so', () => {
  render(<UpstreamsBody slug="api" deploymentScope="staging" environmentName="Staging" />);
  expect(calls.list.at(-1)).toEqual(['api', 'staging']);
  expect(calls.add.at(-1)).toEqual(['api', 'staging']);
  expect(screen.getByRole('note')).toHaveTextContent('Showing Staging’s upstreams.');
  expect(screen.getByRole('button', { name: /declare upstream/i })).toBeInTheDocument();
});

it('production reads as before, with no note', () => {
  render(<UpstreamsBody slug="api" />);
  expect(calls.list.at(-1)).toEqual(['api', undefined]);
  expect(screen.queryByRole('note')).toBeNull();
});

it('a protected stage shows upstreams without declare or remove', () => {
  render(<UpstreamsBody slug="api" deploymentScope="staging" environmentName="Staging" readOnly />);
  expect(screen.queryByRole('button', { name: /declare upstream/i })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Remove .* upstream$/ })).toBeNull();
  expect(screen.getByRole('note')).toHaveTextContent('Staging is protected');
});
