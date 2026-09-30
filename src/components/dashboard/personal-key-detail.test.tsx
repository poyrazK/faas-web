import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalKeyDetail } from './personal-key-detail';

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  retry: vi.fn(),
  pending: false,
  error: null as Error | null,
  missing: false,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account1' } }) }));
vi.mock('@/lib/api/palette', () => ({
  usePaletteKey: (account: string, id: string) => {
    mocks.read(account, id);
    return {
      data: mocks.missing
        ? null
        : {
            id,
            label: 'deploy-bot',
            scopes: ['deploy:write'],
            created: '2026-09-01T00:00:00Z',
            lastUsed: null,
          },
      isPending: mocks.pending,
      isFetching: false,
      error: mocks.error,
      refetch: mocks.retry,
    };
  },
}));
beforeEach(() => {
  mocks.read.mockReset();
  mocks.retry.mockReset();
  mocks.pending = false;
  mocks.error = null;
  mocks.missing = false;
});
describe('API key metadata detail', () => {
  it('reads within the authenticated account and displays metadata only', () => {
    render(<PersonalKeyDetail id="key1" onClose={vi.fn()} />);
    expect(mocks.read).toHaveBeenCalledWith('account1', 'key1');
    expect(screen.getByRole('dialog', { name: 'API key details' })).toHaveTextContent('deploy-bot');
    expect(screen.getByText('deploy:write')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /reveal|copy|rotate|revoke/i })
    ).not.toBeInTheDocument();
  });
  it('reports loading and unavailable records', () => {
    mocks.pending = true;
    const view = render(<PersonalKeyDetail id="key1" onClose={vi.fn()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Reading API key metadata');
    mocks.pending = false;
    mocks.missing = true;
    view.rerender(<PersonalKeyDetail id="key1" onClose={vi.fn()} />);
    expect(screen.getByText(/unavailable for this account/)).toBeInTheDocument();
  });
  it('hides stale metadata on a failed read and offers retry', async () => {
    mocks.error = new Error('Permission denied');
    render(<PersonalKeyDetail id="key1" onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Permission denied');
    expect(screen.queryByText('deploy-bot')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry key details' }));
    expect(mocks.retry).toHaveBeenCalledOnce();
  });
});
