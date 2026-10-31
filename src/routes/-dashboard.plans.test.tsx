import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { Route } from './dashboard.plans';

const mocks = vi.hoisted(() => ({
  changePlan: vi.fn(),
  refreshAccount: vi.fn(),
  toast: vi.fn(),
  goToExternal: vi.fn(),
  openMfa: vi.fn(),
  account: { id: 'account', plan: 'free', status: 'active', limits: {} } as Record<string, unknown>,
}));

vi.mock('@/lib/auth', () => ({
  useAuth: () => ({
    account: mocks.account,
    refreshAccount: mocks.refreshAccount,
  }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/spend-cap', () => ({ SpendCap: () => null }));
vi.mock('@/components/auth/mfa-provider', () => ({ useMfa: () => ({ openMfa: mocks.openMfa }) }));
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
  mocks.openMfa.mockReset();
  mocks.account = { id: 'account', plan: 'free', status: 'active', limits: {} };
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
      expect.objectContaining({ title: 'Now on the Pro plan' })
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
        expect.objectContaining({ kind: 'success', title: 'Now on the Pro plan' })
      )
    );
  });

  it('tells the customer to contact support when no billing page is configured', async () => {
    mocks.changePlan.mockRejectedValue(paymentRequired({ billing_portal_url: '' }));
    await switchToPro();
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'error',
          description: expect.stringMatching(/contact support/i),
        })
      )
    );
    expect(mocks.goToExternal).not.toHaveBeenCalled();
  });

  it('says when a deferred change takes effect and keeps a pending note', async () => {
    const effectiveAt = '2026-11-03T00:00:00Z';
    mocks.changePlan.mockResolvedValue({
      account: { plan: 'free', requested_plan: 'hobby', effective_at: effectiveAt },
      pending: true,
    });
    await switchToPro();
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Plan change pending',
          description: expect.stringContaining(new Date(effectiveAt).toLocaleDateString()),
        })
      )
    );
    const note = screen.getByRole('status', { name: 'Plan change pending' });
    expect(note).toHaveTextContent(/Hobby/);
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('confirms Hobby.') })
    );
    expect(note).toHaveTextContent(new Date(effectiveAt).toLocaleDateString());
  });

  describe('while the provider confirms', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function requestPending() {
      mocks.changePlan.mockResolvedValue({
        account: { plan: 'free', requested_plan: 'pro' },
        pending: true,
      });
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const view = render(<PlansPage />);
      await user.click(screen.getByRole('button', { name: 'Switch to Pro' }));
      await user.click(screen.getByRole('button', { name: 'Confirm switch' }));
      await screen.findByRole('status', { name: 'Plan change pending' });
      mocks.refreshAccount.mockClear();
      return view;
    }

    it('re-reads the account every 15 seconds for at most three minutes', async () => {
      await requestPending();
      await act(() => vi.advanceTimersByTimeAsync(15_000));
      expect(mocks.refreshAccount).toHaveBeenCalledTimes(1);
      await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
      expect(mocks.refreshAccount).toHaveBeenCalledTimes(12);
      // The note stays: the plan has not changed, and the page does not know why.
      expect(screen.getByRole('status', { name: 'Plan change pending' })).toBeInTheDocument();
    });

    it('re-reads the account when the window regains focus', async () => {
      await requestPending();
      act(() => {
        window.dispatchEvent(new Event('focus'));
      });
      expect(mocks.refreshAccount).toHaveBeenCalledTimes(1);
    });

    it('drops the note once the account reports the requested plan', async () => {
      const view = await requestPending();
      mocks.account = { ...mocks.account, plan: 'pro' };
      view.rerender(<PlansPage />);
      await waitFor(() =>
        expect(screen.queryByRole('status', { name: 'Plan change pending' })).toBeNull()
      );
    });
  });

  describe('when the session needs a fresh step-up', () => {
    const stepUpRequired = () =>
      new ApiError({
        title: 'Step-up required',
        status: 403,
        code: 'step_up_required',
        detail: 'step-up MFA required for this action',
      });

    type Opts = { reason?: string; onVerified: (via: string) => void; onDismissed: () => void };
    /** Answer each openMfa call in turn with the given outcome. */
    const answerWith = (...outcomes: Array<(o: Opts) => void>) => {
      outcomes.forEach((outcome) =>
        mocks.openMfa.mockImplementationOnce((_mode: string, opts: Opts) => outcome(opts))
      );
    };

    it('offers sign-in or enrolment, since the console cannot tell which applies, and says why', async () => {
      mocks.changePlan.mockRejectedValue(stepUpRequired());
      answerWith((o) => o.onDismissed());
      await switchToPro();
      await waitFor(() => expect(mocks.openMfa).toHaveBeenCalled());
      const [mode, opts] = mocks.openMfa.mock.calls[0];
      expect(mode).toBe('choose');
      expect(opts.reason).toBe('Plan changes need multi-factor authentication.');
      // Only an authenticator code stamps a step-up (apid handlers_mfa.go), so
      // the recovery option would always be refused here.
      expect(opts.allowRecovery).toBe(false);
    });

    it('retries the change once an authenticator code is accepted', async () => {
      mocks.changePlan
        .mockRejectedValueOnce(stepUpRequired())
        .mockResolvedValueOnce({ account: { plan: 'pro' }, pending: false });
      answerWith((o) => o.onVerified('authenticator'));
      await switchToPro();
      await waitFor(() => expect(mocks.changePlan).toHaveBeenCalledTimes(2));
      expect(mocks.changePlan).toHaveBeenNthCalledWith(2, 'pro');
      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          expect.objectContaining({ kind: 'success', title: 'Now on the Pro plan' })
        )
      );
    });

    it('asks for a fresh code after enrolment, which does not confirm the session, then retries', async () => {
      mocks.changePlan
        .mockRejectedValueOnce(stepUpRequired())
        .mockResolvedValueOnce({ account: { plan: 'pro' }, pending: false });
      answerWith(
        (o) => o.onVerified('enrolment'),
        (o) => o.onVerified('authenticator')
      );
      await switchToPro();
      await waitFor(() => expect(mocks.changePlan).toHaveBeenCalledTimes(2));
      expect(mocks.openMfa).toHaveBeenCalledTimes(2);
      const [mode, opts] = mocks.openMfa.mock.calls[1];
      expect(mode).toBe('verify');
      expect(opts.reason).toMatch(/new code from your authenticator/i);
      expect(opts.allowRecovery).toBe(false);
    });

    it('explains what to do when the verification is dismissed', async () => {
      mocks.changePlan.mockRejectedValue(stepUpRequired());
      answerWith((o) => o.onDismissed());
      await switchToPro();
      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'error',
            description: expect.stringMatching(/confirm it.s you/i),
          })
        )
      );
      expect(mocks.changePlan).toHaveBeenCalledTimes(1);
    });

    it('does not loop when the retry is refused again', async () => {
      mocks.changePlan.mockRejectedValue(stepUpRequired());
      answerWith((o) => o.onVerified('authenticator'));
      await switchToPro();
      await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
      expect(mocks.changePlan).toHaveBeenCalledTimes(2);
      expect(mocks.openMfa).toHaveBeenCalledTimes(1);
      // The code was just accepted; asking for it again would read as a loop.
      expect(mocks.toast).not.toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/confirm it.s you/i) })
      );
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'error',
          description: expect.stringMatching(/could not be confirmed.*try again/i),
        })
      );
    });
  });
});
