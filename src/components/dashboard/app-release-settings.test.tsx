import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '@/lib/api/queries';
import type { CapabilityViewState } from '@/lib/capability-state';
import { spyApi } from '@/test/api';
import { AppReleaseSettings } from './app-release-settings';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  refresh: vi.fn(),
  state: 'available' as CapabilityViewState,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({ accountId: 'account', state: mocks.state, refresh: mocks.refresh }),
}));

const fn = {
  id: 'app-1',
  slug: 'image-resize',
  type: 'function',
  runtime: 'python313',
  concurrency_per_vm: 25,
  release_policy: 'safe',
  function_concurrency: 4,
  manifest: { entrypoint: ['python'] },
} as unknown as App;
const web = {
  ...fn,
  slug: 'api-gateway',
  type: 'app',
  runtime: 'node24',
  release_policy: 'fast',
  release_probe_paths: ['/healthz', '/api/orders'],
  function_concurrency: undefined,
} as unknown as App;

function renderWith(app: App) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppReleaseSettings app={app} />
    </QueryClientProvider>
  );
}

const accepted = (body: object) => ({ data: body, response: new Response() }) as never;
const refused = (status: number, code: string, detail: string) =>
  ({
    error: { status, code, title: 'Refused', detail },
    response: new Response(null, { status }),
  }) as never;

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.toast.mockReset();
  mocks.refresh.mockReset();
  mocks.state = 'available';
});

describe('AppReleaseSettings', () => {
  it('shows the effective policy, what each one does, and where else it is set', () => {
    renderWith(web);
    const policy = screen.getByRole('group', { name: 'Release policy' });
    expect(within(policy).getByRole('button', { name: /fast/i })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(within(policy).getByText(/1%, 10%, 50%, then 100%/)).toBeInTheDocument();
    expect(within(policy).getByText(/5%, 50%, then 100%/)).toBeInTheDocument();
    expect(within(policy).getByText(/all traffic moves at once/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Rollout probe paths')).toHaveValue('/healthz\n/api/orders');
    expect(screen.getByText('gregale app api-gateway --release-policy')).toBeInTheDocument();
    expect(screen.getByText('gregale app api-gateway --release-probe-paths')).toBeInTheDocument();
    // function_concurrency means nothing outside a function app.
    expect(screen.queryByLabelText('Function concurrency')).not.toBeInTheDocument();
  });

  it('reads an app that never set a policy as safe', () => {
    renderWith({ ...fn, release_policy: undefined } as unknown as App);
    expect(screen.getByRole('button', { name: /safe/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Rollout probe paths')).toHaveValue('');
  });

  it('sends only the fields that changed', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(
      accepted({ ...web, release_policy: 'immediate' })
    );
    const user = userEvent.setup();
    renderWith(web);
    const save = screen.getByRole('button', { name: 'Save release settings' });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /immediate/i }));
    await user.click(save);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch).toHaveBeenCalledWith('/v1/apps/{slug}', {
      params: { path: { slug: 'api-gateway' } },
      body: { release_policy: 'immediate' },
    });
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
    );
  });

  it('sends probe paths as a list, and an empty list to go back to /', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(accepted(web));
    const user = userEvent.setup();
    renderWith(web);
    const paths = screen.getByLabelText('Rollout probe paths');
    await user.clear(paths);
    await user.click(screen.getByRole('button', { name: 'Save release settings' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/v1/apps/{slug}', {
        params: { path: { slug: 'api-gateway' } },
        body: { release_probe_paths: [] },
      })
    );
  });

  it('refuses probe paths apid would refuse before sending them', async () => {
    const patch = spyApi('PATCH');
    const user = userEvent.setup();
    renderWith(web);
    const paths = screen.getByLabelText('Rollout probe paths');
    const save = screen.getByRole('button', { name: 'Save release settings' });

    await user.clear(paths);
    await user.type(paths, '/a\n/b\n/c\n/d');
    expect(screen.getByText(/at most 3 paths/i)).toBeInTheDocument();
    expect(paths).toHaveAttribute('aria-invalid', 'true');
    expect(save).toBeDisabled();

    await user.clear(paths);
    await user.type(paths, '/users/{{id}');
    expect(screen.getByText(/no query, wildcard or \{parameter\}/i)).toBeInTheDocument();
    expect(save).toBeDisabled();

    await user.clear(paths);
    await user.type(paths, '/a\n/a');
    expect(screen.getByText(/listed twice/i)).toBeInTheDocument();
    expect(save).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('notes the probes are idle while the policy is immediate', async () => {
    const user = userEvent.setup();
    renderWith(web);
    await user.click(screen.getByRole('button', { name: /immediate/i }));
    expect(screen.getByText(/not used while the policy is immediate/i)).toBeInTheDocument();
  });

  it('edits function concurrency within the plan bound, from the next deploy', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(accepted({ ...fn, function_concurrency: 8 }));
    const user = userEvent.setup();
    renderWith(fn);
    const field = screen.getByLabelText('Function concurrency');
    expect(field).toHaveValue(4);
    expect(screen.getByText(/up to 25 on your plan/i)).toBeInTheDocument();
    expect(screen.getByText(/functions:/)).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, '26');
    expect(screen.getByText(/between 1 and 25/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save release settings' })).toBeDisabled();

    await user.clear(field);
    await user.type(field, '8');
    await user.click(screen.getByRole('button', { name: 'Save release settings' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/v1/apps/{slug}', {
        params: { path: { slug: 'image-resize' } },
        body: { function_concurrency: 8 },
      })
    );
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/next deploy/i) })
      )
    );
  });

  it('reads an unset function concurrency as one request per worker', () => {
    renderWith({ ...fn, function_concurrency: undefined } as unknown as App);
    expect(screen.getByLabelText('Function concurrency')).toHaveValue(1);
  });

  it('notes when the default rollout does not apply to the app', () => {
    renderWith({ ...web, manifest: { entrypoint: ['x'], execution_mode: 'worker' } } as never);
    expect(screen.getByText(/worker mode/i)).toBeInTheDocument();
  });

  describe('while progressive rollouts are not released', () => {
    beforeEach(() => {
      mocks.state = 'plan-not-entitled';
    });

    it('keeps fast and immediate, but not newly choosing safe or probe paths', () => {
      renderWith(web);
      expect(screen.getByRole('button', { name: /safe/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /immediate/i })).toBeEnabled();
      expect(screen.getByLabelText('Rollout probe paths')).toBeDisabled();
      expect(screen.getByText(/progressive rollouts/i)).toBeInTheDocument();
    });

    it('leaves safe selectable when it is already the policy', () => {
      renderWith(fn);
      expect(screen.getByRole('button', { name: /safe/i })).toBeEnabled();
    });

    it('still edits function concurrency, which autoscaling owns', () => {
      renderWith(fn);
      expect(screen.getByLabelText('Function concurrency')).toBeEnabled();
    });
  });

  it('rechecks availability when apid says the capability is not released', async () => {
    spyApi('PATCH').mockResolvedValue(
      refused(403, 'capability_not_released', 'Progressive rollouts is not released.')
    );
    const user = userEvent.setup();
    renderWith(web);
    await user.click(screen.getByRole('button', { name: /safe/i }));
    await user.click(screen.getByRole('button', { name: 'Save release settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not released/i);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('shows the field apid refused on validation_failed', async () => {
    spyApi('PATCH').mockResolvedValue(
      refused(400, 'validation_failed', 'function_concurrency 9 must be between 0 and 5')
    );
    const user = userEvent.setup();
    renderWith(fn);
    const field = screen.getByLabelText('Function concurrency');
    await user.clear(field);
    await user.type(field, '9');
    await user.click(screen.getByRole('button', { name: 'Save release settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/between 0 and 5/);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
