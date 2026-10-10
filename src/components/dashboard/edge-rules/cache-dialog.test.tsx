import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { EdgeRule } from '@/lib/api/queries';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  capability: 'available',
  accountId: 'account-a',
  plan: 'hobby',
  create: vi.fn(),
  update: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({
  useCreateEdgeRule: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateEdgeRule: () => ({ mutateAsync: state.update, isPending: false }),
  useThrottleSuggestions: () => ({ data: undefined, isPending: false, error: null }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: state.accountId, plan: state.plan } }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({
    accountId: state.accountId,
    state: state.capability,
    refresh: vi.fn(),
  }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));

import { EdgeRuleDialog } from './dialog';

function mount(rule: EdgeRule | null = null) {
  return render(
    <EdgeRuleDialog
      open
      onClose={vi.fn()}
      rule={rule}
      slug="api"
      apps={[{ slug: 'api' }]}
      nextPriority={10}
    />
  );
}

beforeEach(() => {
  state.capability = 'available';
  state.accountId = 'account-a';
  state.plan = 'hobby';
  state.create.mockReset().mockResolvedValue({});
  state.update.mockReset().mockResolvedValue({});
  state.toast.mockReset();
});

it('creates a cache rule matched only on GET and HEAD with the reviewed action', async () => {
  mount();
  await userEvent.click(screen.getByRole('button', { name: /Response cache/ }));
  expect(screen.queryByRole('button', { name: 'POST' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
  expect(state.create).toHaveBeenCalledWith(
    expect.objectContaining({
      slug: 'api',
      kind: 'cache',
      match_methods: ['GET', 'HEAD'],
      action: expect.objectContaining({
        max_age_seconds: 60,
        stale_while_revalidate_seconds: 0,
        stale_if_error_seconds: 300,
        methods: ['GET', 'HEAD'],
      }),
    })
  );
});

it('disables cache selection after registry failure while keeping other rule kinds usable', async () => {
  state.capability = 'registry-error';
  mount();
  const cache = screen.getByRole('button', { name: /Response cache/ });
  expect(cache).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(cache);
  expect(state.create).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: /Route to an app/ })).toHaveAttribute(
    'aria-disabled',
    'false'
  );
});

it('does not submit an opened cache editor after the account changes', async () => {
  const rule: EdgeRule = {
    id: 'cache-1',
    account_id: 'account-a',
    app_id: 'app-1',
    kind: 'cache',
    match_host: '*',
    match_path: '/products/*',
    match_methods: ['GET'],
    priority: 10,
    enabled: true,
    validate_mode: 'block',
    action: {
      max_age_seconds: 60,
      stale_while_revalidate_seconds: 0,
      stale_if_error_seconds: 300,
      methods: ['GET'],
    },
    created_at: '2026-10-10T00:00:00Z',
    updated_at: '2026-10-10T00:00:00Z',
  };
  const view = mount(rule);
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  state.accountId = 'account-b';
  view.rerender(
    <EdgeRuleDialog
      open
      onClose={vi.fn()}
      rule={rule}
      slug="api"
      apps={[{ slug: 'api' }]}
      nextPriority={10}
    />
  );
  expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(state.update).not.toHaveBeenCalled();
});

it('shows a permission rejection instead of silently closing a cache form', async () => {
  state.create.mockRejectedValueOnce(
    new ApiError({ status: 403, code: 'forbidden', title: 'Access denied' })
  );
  mount();
  await userEvent.click(screen.getByRole('button', { name: /Response cache/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Access denied/);
});
