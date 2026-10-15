import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { api } from '@/lib/api/client';
import { status } from '@/test/runtime-policy';

const restart = vi.fn();
const purge = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();
const capability = { state: 'available', accountId: 'account', plan: 'hobby' };

vi.mock('@/lib/api/queries', () => ({
  useRestartApp: () => ({ mutateAsync: restart, isPending: false }),
  usePurgeAppCache: () => ({ mutateAsync: purge, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: capability.accountId, plan: capability.plan } }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({ ...capability, refresh: vi.fn() }),
}));
vi.mock('./policy-status', () => ({ PolicyStatus: () => null }));

const { PurgeCacheControl, RestartAppButton } = await import('./app-lifecycle');

beforeEach(() => {
  restart.mockReset().mockResolvedValue({ wake_id: 'wk_abcdef123456' });
  purge.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  capability.state = 'available';
  capability.accountId = 'account';
  capability.plan = 'hobby';
  vi.spyOn(api, 'GET').mockResolvedValue({ data: status, response: new Response() } as never);
});

describe('RestartAppButton', () => {
  it('confirms, then names the replacement wake so it can be found', async () => {
    render(<RestartAppButton slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /restart/i }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }))
    );
    await waitFor(() => expect(restart).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('wk_abcdef123') })
    );
  });

  it('reads a 409 as one already running and a 402 as the spend cap', async () => {
    restart.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'conflict', title: 'Conflict' })
    );
    render(<RestartAppButton slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /restart/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Already restarting' }))
    );

    restart.mockRejectedValueOnce(
      new ApiError({ status: 402, code: 'admission_refused', title: 'Refused' })
    );
    await userEvent.click(screen.getByRole('button', { name: /restart/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Spend cap reached' }))
    );
  });
});

describe('PurgeCacheControl', () => {
  it('purges everything when no glob is given, and says a purge was requested', async () => {
    render(<PurgeCacheControl slug="api" appId="app-1" />);
    await userEvent.click(screen.getByRole('button', { name: /purge/i }));
    await waitFor(() => expect(purge).toHaveBeenCalledWith({}));
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Purge requested' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringContaining('may remain') })
    );
    expect(screen.getByText(/optional shared Redis/)).toBeVisible();
  });

  it('passes the glob through when one is typed', async () => {
    render(<PurgeCacheControl slug="api" appId="app-1" />);
    await userEvent.selectOptions(screen.getByLabelText('Purge scope'), 'path');
    await userEvent.type(screen.getByLabelText('Path glob to purge'), '/products/*');
    await userEvent.click(screen.getByRole('button', { name: /purge/i }));
    await waitFor(() => expect(purge).toHaveBeenCalledWith({ path: '/products/*' }));
  });

  it('sends a normalized tag only after switching from a previously typed path', async () => {
    render(<PurgeCacheControl slug="api" appId="app-1" />);
    await userEvent.selectOptions(screen.getByLabelText('Purge scope'), 'path');
    await userEvent.type(screen.getByLabelText('Path glob to purge'), '/products/*');
    await userEvent.selectOptions(screen.getByLabelText('Purge scope'), 'tag');
    await userEvent.type(screen.getByLabelText('Cache tag to purge'), 'Product:42');
    await userEvent.click(screen.getByRole('button', { name: /purge/i }));
    await waitFor(() => expect(purge).toHaveBeenCalledWith({ tag: 'product:42' }));
  });

  it('rejects an invalid tag before confirmation or a request', async () => {
    render(<PurgeCacheControl slug="api" appId="app-1" />);
    await userEvent.selectOptions(screen.getByLabelText('Purge scope'), 'tag');
    await userEvent.type(screen.getByLabelText('Cache tag to purge'), 'bad tag');
    await userEvent.click(screen.getByRole('button', { name: /purge/i }));
    expect(confirm).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/one cache tag/i);
  });

  it('refuses Free, runtime-off and failed-registry writes', () => {
    for (const [plan, state] of [
      ['free', 'available'],
      ['hobby', 'runtime-unavailable'],
      ['hobby', 'registry-error'],
    ]) {
      capability.plan = plan;
      capability.state = state;
      const view = render(<PurgeCacheControl slug="api" appId="app-1" />);
      expect(screen.getByRole('button', { name: /purge/i })).toBeDisabled();
      view.unmount();
    }
  });

  it('drops a delayed confirmation after the account or capability changes', async () => {
    let decide!: (answer: boolean) => void;
    confirm.mockReturnValue(new Promise<boolean>((resolve) => (decide = resolve)));
    const view = render(<PurgeCacheControl slug="api" appId="app-1" />);
    await userEvent.click(screen.getByRole('button', { name: /purge/i }));
    capability.state = 'registry-error';
    view.rerender(<PurgeCacheControl slug="api" appId="app-1" />);
    await act(async () => decide(true));
    expect(purge).not.toHaveBeenCalled();
  });

  it('drops a delayed confirmation after the account and app change', async () => {
    let decide!: (answer: boolean) => void;
    confirm.mockReturnValue(new Promise<boolean>((resolve) => (decide = resolve)));
    const view = render(<PurgeCacheControl slug="api" appId="app-1" />);
    await userEvent.click(screen.getByRole('button', { name: /purge/i }));
    capability.accountId = 'other-account';
    view.rerender(<PurgeCacheControl slug="other-app" appId="app-2" />);
    await act(async () => decide(true));
    expect(purge).not.toHaveBeenCalled();
  });

  it('drops a write after a delayed policy baseline read and plan downgrade', async () => {
    let finish!: (value: never) => void;
    vi.spyOn(api, 'GET').mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const view = render(<PurgeCacheControl slug="api" appId="app-1" />);
    await userEvent.click(screen.getByRole('button', { name: /purge/i }));
    await waitFor(() => expect(api.GET).toHaveBeenCalled());
    capability.plan = 'free';
    view.rerender(<PurgeCacheControl slug="api" appId="app-1" />);
    await act(async () => {
      finish({ data: status, response: new Response() } as never);
    });
    expect(purge).not.toHaveBeenCalled();
  });
});
