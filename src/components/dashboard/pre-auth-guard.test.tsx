import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useApp = vi.fn();
const save = vi.fn();
const usePreAuthObservations = vi.fn();
const useCapability = vi.fn();
const useCapabilityAccess = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();
const account = vi.fn();

vi.mock('@/lib/api/queries', () => ({ useApp: (slug: string) => useApp(slug) as unknown }));
vi.mock('@/lib/api/edge-protection', () => ({
  useUpdatePreAuthGuard: () => ({ mutateAsync: save, isPending: false }),
  usePreAuthObservations: (slug: string, range: string, enabled: boolean) =>
    usePreAuthObservations(slug, range, enabled) as unknown,
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => useCapability(key) as unknown,
  useCapabilityAccess: (key: string) => useCapabilityAccess(key) as unknown,
}));
vi.mock('@/lib/api/workspace-apps', () => ({
  useWorkspaceTarget: () => ({ org: 'acme', label: 'Acme Inc', ready: true }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: account() as unknown }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { PreAuthGuardPanel } = await import('./pre-auth-guard');

const guard = {
  mode: 'observe',
  requests_per_second: 20,
  burst: 40,
  routes: [{ method: 'POST', path: '/login', requests_per_second: 2, burst: 4 }],
};
const appWith = (pre_auth_rate_limit?: unknown) => ({
  data: { slug: 'api', manifest: { entrypoint: [], pre_auth_rate_limit } },
  isPending: false,
  error: null,
  refetch: vi.fn(),
});

beforeEach(() => {
  useApp.mockReset().mockReturnValue(appWith(guard));
  save.mockReset().mockResolvedValue({});
  usePreAuthObservations.mockReset().mockReturnValue({
    data: undefined,
    isPending: true,
    error: null,
  });
  useCapability.mockReset().mockImplementation((key: string) => ({
    capability: { key, maturity: 'beta' },
    state: 'available',
    refresh: vi.fn(),
  }));
  useCapabilityAccess.mockReset().mockReturnValue({ access: 'on', refresh: vi.fn() });
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  account.mockReset().mockReturnValue({ id: 'acct', plan: 'pro' });
});

const region = () => screen.getByRole('region', { name: 'Pre-auth guard' });
const field = (label: string) => within(region()).getByLabelText(label);
const mode = (name: string) => within(region()).getByRole('button', { name });

describe('PreAuthGuardPanel', () => {
  it('shows the stored guard: its mode, rate and route overrides', () => {
    render(<PreAuthGuardPanel slug="api" />);
    expect(within(region()).getByText('Observing')).toBeInTheDocument();
    expect(mode('Observe')).toHaveAttribute('aria-pressed', 'true');
    expect(field('Requests per second, per source')).toHaveValue(20);
    expect(field('Burst, per source')).toHaveValue(40);
    expect(field('Route 1 path')).toHaveValue('/login');
  });

  it('reads an app with no stored guard as off, starting a Free app at its plan rate', async () => {
    account.mockReturnValue({ id: 'acct', plan: 'free' });
    useApp.mockReturnValue(appWith(undefined));
    render(<PreAuthGuardPanel slug="api" />);
    expect(mode('Off')).toHaveAttribute('aria-pressed', 'true');
    expect(within(region()).getByText(/no per-source limit runs/i)).toBeInTheDocument();
    await userEvent.click(mode('Observe'));
    expect(field('Requests per second, per source')).toHaveValue(5);
    expect(field('Burst, per source')).toHaveValue(20);
    await userEvent.click(within(region()).getByRole('button', { name: 'Save guard' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith({ mode: 'observe', requests_per_second: 5, burst: 20 });
  });

  it('saves a changed rate without asking, sending the routes too: apid replaces the config', async () => {
    render(<PreAuthGuardPanel slug="api" />);
    const save_ = within(region()).getByRole('button', { name: 'Save guard' });
    expect(save_).toBeDisabled();
    await userEvent.clear(field('Requests per second, per source'));
    await userEvent.type(field('Requests per second, per source'), '30');
    await userEvent.click(save_);
    expect(confirm).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith({ ...guard, requests_per_second: 30 });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('says what enforce does, with the 24-hour check, before switching to it', async () => {
    usePreAuthObservations.mockReturnValue({
      data: {
        policies: [],
        suggestion: {
          status: 'review',
          reason: 'enforce would have rejected 3 requests that succeeded',
          requests: 5000,
          would_block: 49,
          would_block_succeeded: 3,
        },
      },
      isPending: false,
      error: null,
    });
    confirm.mockResolvedValueOnce(false);
    render(<PreAuthGuardPanel slug="api" />);
    await userEvent.click(mode('Enforce'));
    expect(usePreAuthObservations).toHaveBeenLastCalledWith('api', '24h', true);
    expect(within(region()).getByText(/gets 429 with Retry-After: 1/)).toBeInTheDocument();
    expect(within(region()).getByText('Review before enforcing')).toBeInTheDocument();
    await userEvent.click(within(region()).getByRole('button', { name: 'Save guard' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Enforce the pre-auth guard on api?',
        destructive: true,
        description: expect.stringMatching(
          /429.*Review before enforcing: enforce would have rejected 3 requests/s
        ) as unknown,
      })
    );
    expect(save).not.toHaveBeenCalled();

    await userEvent.click(within(region()).getByRole('button', { name: 'Save guard' }));
    expect(save).toHaveBeenCalledWith({ ...guard, mode: 'enforce' });
  });

  it('confirms switching off and keeps the rate and routes for later', async () => {
    render(<PreAuthGuardPanel slug="api" />);
    await userEvent.click(mode('Off'));
    await userEvent.click(within(region()).getByRole('button', { name: 'Save guard' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Switch the pre-auth guard off for api?' })
    );
    expect(save).toHaveBeenCalledWith({ ...guard, mode: 'off' });
  });

  it('refuses a route override above the app-wide rate before asking apid', async () => {
    render(<PreAuthGuardPanel slug="api" />);
    await userEvent.click(within(region()).getByRole('button', { name: 'Add route override' }));
    await userEvent.clear(field('Route 2 path'));
    await userEvent.type(field('Route 2 path'), '/signup');
    await userEvent.clear(field('Route 2 requests per second'));
    await userEvent.type(field('Route 2 requests per second'), '50');
    await userEvent.click(within(region()).getByRole('button', { name: 'Save guard' }));
    expect(save).not.toHaveBeenCalled();
    expect(within(region()).getByText('From 1 to the app-wide 20.')).toBeInTheDocument();
  });

  it('sets a failed-response budget on a route', async () => {
    render(<PreAuthGuardPanel slug="api" />);
    await userEvent.click(
      within(region()).getByRole('switch', { name: 'Route 1 failed responses' })
    );
    await userEvent.type(field('Route 1 failures per minute'), '5');
    await userEvent.type(field('Route 1 failure burst'), '3');
    await userEvent.click(within(region()).getByRole('button', { name: 'Save guard' }));
    expect(save).toHaveBeenCalledWith({
      ...guard,
      routes: [{ ...guard.routes[0], failed_responses: { failures_per_minute: 5, burst: 3 } }],
    });
  });

  it('removes a route override', async () => {
    render(<PreAuthGuardPanel slug="api" />);
    await userEvent.click(
      within(region()).getByRole('button', { name: 'Remove route override POST /login' })
    );
    await userEvent.click(within(region()).getByRole('button', { name: 'Save guard' }));
    expect(save).toHaveBeenCalledWith({ mode: 'observe', requests_per_second: 20, burst: 40 });
  });

  it("shows apid's refusal with its code, such as a rate over the plan's", async () => {
    save.mockRejectedValue(
      new ApiError({
        status: 400,
        code: 'validation_failed',
        title: 'Invalid pre-auth rate limit',
        detail: 'pre_auth_rate_limit requests_per_second must be 1..100 and burst must be 1..500',
      })
    );
    render(<PreAuthGuardPanel slug="api" />);
    await userEvent.clear(field('Requests per second, per source'));
    await userEvent.type(field('Requests per second, per source'), '300');
    await userEvent.click(within(region()).getByRole('button', { name: 'Save guard' }));
    const alert = within(region()).getByRole('alert');
    expect(alert).toHaveTextContent('must be 1..100');
    expect(alert).toHaveTextContent('validation_failed');
  });

  it('names the organization when a company role may not change app settings', async () => {
    save.mockRejectedValue(
      new ApiError({ status: 403, code: 'org_role_forbidden', title: 'Forbidden' })
    );
    render(<PreAuthGuardPanel slug="api" />);
    await userEvent.click(mode('Enforce'));
    await userEvent.click(within(region()).getByRole('button', { name: 'Save guard' }));
    expect(within(region()).getByRole('alert')).toHaveTextContent(
      'In Acme Inc, changing an app’s settings needs the owner, admin or developer role.'
    );
  });

  it('shows the guard but offers no change while edge protection is not released', () => {
    useCapabilityAccess.mockReturnValue({ access: 'off', refresh: vi.fn() });
    render(<PreAuthGuardPanel slug="api" />);
    expect(
      within(region()).getByText(/observe · 20 rps, burst 40 per source/i)
    ).toBeInTheDocument();
    expect(within(region()).getByText(/not yet available to this account/i)).toBeInTheDocument();
    expect(within(region()).queryByRole('button', { name: 'Save guard' })).toBeNull();
  });

  it('reads the app before showing anything', () => {
    useApp.mockReturnValue({ data: undefined, isPending: true, error: null, refetch: vi.fn() });
    render(<PreAuthGuardPanel slug="api" />);
    expect(within(region()).getByText('Reading the pre-auth guard…')).toBeInTheDocument();
  });
});
