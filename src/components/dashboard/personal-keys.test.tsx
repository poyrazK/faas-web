import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/queries', () => ({
  useApiKeys: () => ({
    data: [
      {
        id: 'k1',
        label: 'ci',
        prefix: 'gk_used',
        scopes: ['deploy'],
        last_used_at: '2026-09-11T00:00:00Z',
      },
      { id: 'k2', label: 'spare', prefix: 'gk_idle', scopes: ['deploy'] },
      {
        id: 'k3',
        label: 'zeroed',
        prefix: 'gk_zero',
        scopes: ['deploy'],
        last_used_at: '0001-01-01T00:00:00Z',
      },
    ],
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateApiKey: () => ({ mutateAsync: vi.fn(), isPending: false, reset: vi.fn() }),
  useDeleteApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRotateApiKey: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGraceWindow: () => ({ data: { days: 7, plan_default: 7 }, isPending: false, error: null }),
  useSetGraceWindow: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));

const { PersonalKeysBody } = await import('./personal-keys');

describe('API keys table', () => {
  it('shows last use as a time with the exact time on hover, and "Never" for an unused key', () => {
    render(<PersonalKeysBody />);

    const used = screen.getByRole('time');
    expect(used).toHaveAttribute('dateTime', '2026-09-11T00:00:00.000Z');
    expect(used).toHaveAttribute('title', expect.stringContaining('2026'));
    expect(used).toHaveTextContent(/ago$/);

    expect(screen.getByText('spare').closest('tr')).toHaveTextContent('Never');
  });

  it('reads a zero-time last use as "Never", not a dash', () => {
    render(<PersonalKeysBody />);

    const row = screen.getByText('zeroed').closest('tr');
    expect(row).toHaveTextContent('Never');
    expect(within(row as HTMLElement).queryByRole('time')).not.toBeInTheDocument();
  });
});
