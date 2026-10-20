import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { Route } from './dashboard.plans';

const mocks = vi.hoisted(() => ({
  changePlan: vi.fn(),
  refreshAccount: vi.fn(),
  toast: vi.fn(),
  goToExternal: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    account: { id: 'account', plan: 'free', status: 'active', limits: {} },
    refreshAccount: mocks.refreshAccount,
  }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/spend-cap', () => ({ SpendCap: () => null }));
vi.mock('@/lib/external-navigation', () => ({ goToExternal: mocks.goToExternal }));
vi.mock('@/lib/api/queries', () => ({
  useChangePlan: () => ({ mutateAsync: mocks.changePlan, isPending: false }),
  useBillingPortal: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCancelBilling: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRetryBilling: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const PlansPage = Route.options.component!;

function paymentRequired(body: Record<string, string>) {
  return new ApiError({
    title: 'Payment required',
    status: 402,
    code: 'payment_required',
    ...body,
  });
}

async function switchToPro() {
  const user = userEvent.setup();
  render(<PlansPage />);
  await user.click(screen.getByRole('button', { name: 'Switch to Pro' }));
  await user.click(screen.getByRole('button', { name: 'Confirm switch' }));
}

beforeEach(() => {
  mocks.changePlan.mockReset();
  mocks.refreshAccount.mockReset().mockResolvedValue(undefined);
  mocks.toast.mockReset();
  mocks.goToExternal.mockReset();
});

describe('Plan change', () => {
  it('sends an upgrade that needs a subscription to the hosted checkout', async () => {
    mocks.changePlan.mockRejectedValue(
      paymentRequired({ checkout_url: 'https://checkout.example/session' })
    );
    await switchToPro();
    await waitFor(() =>
      expect(mocks.goToExternal).toHaveBeenCalledWith('https://checkout.example/session')
    );
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
  });

  it('sends a change to an existing subscription to the billing portal', async () => {
    mocks.changePlan.mockRejectedValue(
      paymentRequired({ billing_portal_url: 'https://billing.example/portal' })
    );
    await switchToPro();
    await waitFor(() =>
      expect(mocks.goToExternal).toHaveBeenCalledWith('https://billing.example/portal')
    );
  });

  it('does not claim the new plan while the provider has yet to confirm it', async () => {
    mocks.changePlan.mockResolvedValue({ account: { plan: 'free' }, pending: true });
    await switchToPro();
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Now on the pro plan' })
    );
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/pending/i) })
    );
  });

  it('confirms a plan change the provider has applied', async () => {
    mocks.changePlan.mockResolvedValue({ account: { plan: 'pro' }, pending: false });
    await switchToPro();
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'Now on the pro plan' })
      )
    );
  });
});
