import { useCallback, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAppDeployments = vi.fn();
const resetCompare = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useAppDeployments: (slug: string) => useAppDeployments(slug) as unknown,
  useCompareDeployments: () => {
    const [variables, setVariables] = useState<{
      source: string;
      mirror: string;
      since: string;
      route?: string;
    }>();
    const [data, setData] = useState<
      | {
          routes: Array<{
            route: string;
            source_p95_ms: number;
            mirror_p95_ms: number;
          }>;
        }
      | undefined
    >();
    const reset = useCallback(() => {
      resetCompare();
      setData(undefined);
      setVariables(undefined);
    }, []);
    const mutateAsync = useCallback(
      async (body: { source: string; mirror: string; since: string; route?: string }) => {
        setVariables(body);
        setData({
          routes: [{ route: '/alpha-only', source_p95_ms: 10, mirror_p95_ms: 12 }],
        });
      },
      []
    );

    return { data, variables, error: null, isPending: false, mutateAsync, reset };
  },
}));
vi.mock('./debug-gate', () => ({
  DebugGate: ({ children }: { children: React.ReactNode }) => children,
  isPlanGated: () => false,
}));
vi.mock('@/components/dashboard/resource-table', () => ({
  ResourceTable: ({ rows }: { rows: Array<{ route: string }> }) => (
    <div>{rows.map((row) => row.route).join(', ')}</div>
  ),
}));

const { DebugCompare } = await import('./debug-compare');

function deployments(slug: string) {
  return {
    data: {
      pages: [
        {
          items: [
            { id: `${slug}-a`, status: 'live' },
            { id: `${slug}-b`, status: 'complete' },
          ],
        },
      ],
    },
    error: null,
    isPending: false,
    refetch: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  };
}

beforeEach(() => {
  resetCompare.mockReset();
  useAppDeployments.mockReset().mockImplementation((slug: string) => deployments(slug));
});

describe('DebugCompare app scope', () => {
  it('clears app-owned selections and results when the app changes', async () => {
    const { rerender } = render(<DebugCompare slug="alpha" />);

    fireEvent.change(screen.getByLabelText('Deployment A'), { target: { value: 'alpha-a' } });
    fireEvent.change(screen.getByLabelText('Deployment B'), { target: { value: 'alpha-b' } });
    fireEvent.change(screen.getByLabelText('Compare window'), { target: { value: '1h' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));

    expect(await screen.findByText('/alpha-only')).toBeInTheDocument();
    resetCompare.mockClear();

    rerender(<DebugCompare slug="beta" />);

    await waitFor(() => expect(resetCompare).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('/alpha-only')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Deployment A')).toHaveValue('');
    expect(screen.getByLabelText('Deployment B')).toHaveValue('');
    expect(screen.getByLabelText('Compare window')).toHaveValue('1h');
  });
});
