import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import type { Account } from '@/lib/auth';

const useTriggers = vi.fn();
const useApps = vi.fn();
const setEnabled = vi.fn();
const useAuth = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useTriggers: () => useTriggers(),
  useApps: () => useApps(),
  useSetTriggerEnabled: () => ({ mutateAsync: setEnabled, isPending: false, variables: undefined }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => useAuth() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { TriggersPage } = await import('./dashboard.triggers.index');

const account = {
  plan: 'pro',
  limits: { triggers_allowed: true },
} as Account;

beforeEach(() => {
  useAuth.mockReturnValue({ account, loading: false, apiReachable: true });
  useApps.mockReturnValue({
    data: [{ id: 'app1', slug: 'orders-api' }],
    isPending: false,
    error: null,
  });
  useTriggers.mockReturnValue({
    data: [
      {
        id: 't1',
        app_id: 'app1',
        kind: 'kafka',
        slug: 'orders',
        enabled: true,
        batch_size_max: 64,
        batch_window_ms: 1000,
        max_attempts: 5,
        updated_at: '2026-09-09T00:00:00Z',
      },
    ],
    isPending: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe('TriggersPage', () => {
  it('uses routed creation and detail links instead of inline panels', async () => {
    render(withRouter(<TriggersPage />));
    expect(await screen.findByRole('link', { name: /create trigger/i })).toHaveAttribute(
      'href',
      '/dashboard/triggers/new'
    );
    expect(screen.getByRole('link', { name: 'orders' })).toHaveAttribute(
      'href',
      '/dashboard/triggers/t1'
    );
    expect(screen.queryByText('New trigger')).not.toBeInTheDocument();
  });

  it('sends Free accounts to plans while keeping the readable list', async () => {
    useAuth.mockReturnValue({
      account: { ...account, plan: 'free', limits: { triggers_allowed: false } },
      loading: false,
      apiReachable: true,
    });
    render(withRouter(<TriggersPage />));
    expect(await screen.findByRole('link', { name: /compare plans/i })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
    expect(screen.getByRole('link', { name: 'orders' })).toBeInTheDocument();
  });

  it('keeps no-app and no-trigger states distinct', async () => {
    useApps.mockReturnValue({ data: [], isPending: false, error: null });
    useTriggers.mockReturnValue({ data: [], isPending: false, error: null, refetch: vi.fn() });
    render(withRouter(<TriggersPage />));
    expect(await screen.findByText(/create an app before adding a trigger/i)).toBeInTheDocument();
  });
});
