import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { DeployTokensPanel } from './deploy-tokens';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), toast: vi.fn(), openMfa: vi.fn() }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/auth/mfa-provider', () => ({ useMfa: () => ({ openMfa: mocks.openMfa }) }));

const SECRET = 'fp_deploy_' + 'a'.repeat(64);

const active = {
  id: '6f1c2b1e-0000-4000-8000-000000000001',
  app_id: 'app-1',
  prefix: 'fp_deploy_',
  label: 'github-actions',
  scopes: ['deploy:write'],
  status: 'active',
  created_at: '2026-10-01T09:00:00Z',
  expires_at: '2099-12-30T09:00:00Z',
  last_used_at: '2026-10-30T14:00:00Z',
};
const revoked = {
  id: '6f1c2b1e-0000-4000-8000-000000000002',
  app_id: 'app-1',
  prefix: 'fp_deploy_',
  label: 'old-jenkins',
  scopes: ['deploy:write'],
  status: 'revoked',
  created_at: '2026-06-01T09:00:00Z',
  expires_at: '2026-08-30T09:00:00Z',
  revoked_at: '2026-07-01T09:00:00Z',
};

const ok = (data: unknown, status = 200) => ({
  data,
  response: new Response(null, { status }),
});
const problem = (status: number, code: string) => ({
  error: { status, code, title: code, detail: `${code} detail` },
  response: new Response(null, { status }),
});

function mount(slug = 'alpha') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DeployTokensPanel slug={slug} />
    </QueryClientProvider>
  );
}

let list: unknown[];
beforeEach(() => {
  vi.restoreAllMocks();
  list = [active, revoked];
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.toast.mockReset();
  mocks.openMfa.mockReset();
  spyApi('GET').mockImplementation(async () => ok({ tokens: list }) as never);
});

describe('DeployTokensPanel', () => {
  it('lists label, status, created, last used and expiry; revoked rows have no actions', async () => {
    mount();
    const row = await screen.findByRole('listitem', { name: /github-actions/ });
    expect(row).toHaveTextContent('fp_deploy_…');
    expect(row).toHaveTextContent('Active');
    expect(row).toHaveTextContent(/Created/);
    expect(row).toHaveTextContent(/Last used/);
    expect(row).toHaveTextContent(/Expires/);
    expect(within(row).getByRole('button', { name: 'Rotate github-actions' })).toBeEnabled();
    expect(within(row).getByRole('button', { name: 'Revoke github-actions' })).toBeEnabled();

    const gone = screen.getByRole('listitem', { name: /old-jenkins/ });
    expect(gone).toHaveTextContent('Revoked');
    expect(gone).toHaveTextContent(/Never used/);
    expect(within(gone).queryByRole('button')).toBeNull();
  });

  it('marks a lapsed token expired and offers only revoke', async () => {
    list = [{ ...active, expires_at: '2020-01-01T00:00:00Z' }];
    mount();
    const row = await screen.findByRole('listitem', { name: /github-actions/ });
    expect(row).toHaveTextContent('Expired');
    expect(within(row).queryByRole('button', { name: /Rotate/ })).toBeNull();
    expect(within(row).getByRole('button', { name: 'Revoke github-actions' })).toBeEnabled();
  });

  it('says so when the app has no tokens', async () => {
    list = [];
    mount();
    expect(await screen.findByText('No deploy tokens yet.')).toBeInTheDocument();
  });

  it('shows the CI command that picks the token up from FAAS_TOKEN', async () => {
    mount('alpha');
    expect(await screen.findByText('gregale deploy --name alpha')).toBeInTheDocument();
    expect(screen.getAllByText('FAAS_TOKEN').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: 'Copy: gregale deploy --name alpha' })
    ).toBeInTheDocument();
  });

  it('creates a token and shows the secret exactly once', async () => {
    const post = spyApi('POST').mockResolvedValue(
      ok({ ...active, id: 'new', label: 'ci', plaintext: SECRET }, 201) as never
    );
    mount();
    await screen.findByRole('listitem', { name: /github-actions/ });
    await userEvent.type(screen.getByLabelText('Label'), 'ci');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/deploy-tokens', {
        params: { path: { slug: 'alpha' } },
        body: { label: 'ci' },
      })
    );
    const reveal = await screen.findByRole('region', { name: 'New deploy token' });
    expect(reveal).toHaveTextContent(/won.t see it again/i);
    expect(reveal).not.toHaveTextContent(SECRET);
    await userEvent.click(within(reveal).getByRole('button', { name: 'Reveal' }));
    expect(reveal).toHaveTextContent(SECRET);
    expect(within(reveal).getByRole('button', { name: /Copy/ })).toBeInTheDocument();

    await userEvent.click(within(reveal).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(SECRET)).toBeNull();
    expect(screen.queryByRole('region', { name: 'New deploy token' })).toBeNull();
  });

  it('sends an explicit expiry when one other than the 90-day default is picked', async () => {
    const post = spyApi('POST').mockResolvedValue(
      ok({ ...active, plaintext: SECRET }, 201) as never
    );
    mount();
    await screen.findByRole('listitem', { name: /github-actions/ });
    await userEvent.selectOptions(screen.getByLabelText('Expires in'), '30');
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    const body = (post.mock.calls[0][1] as { body: { expires_at?: string } }).body;
    const days = (Date.parse(body.expires_at!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('asks for a step-up on step_up_required and retries once verified', async () => {
    const post = spyApi('POST')
      .mockResolvedValueOnce(problem(403, 'step_up_required') as never)
      .mockResolvedValueOnce(ok({ ...active, plaintext: SECRET }, 201) as never);
    mocks.openMfa.mockImplementation((_mode, opts: { onVerified: () => void }) =>
      opts.onVerified()
    );
    mount();
    await screen.findByRole('listitem', { name: /github-actions/ });
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByRole('region', { name: 'New deploy token' })).toBeInTheDocument();
    expect(mocks.openMfa).toHaveBeenCalledWith('verify', expect.anything());
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('explains the step-up when the person dismisses the MFA prompt', async () => {
    spyApi('POST').mockResolvedValue(problem(403, 'step_up_required') as never);
    mocks.openMfa.mockImplementation((_mode, opts: { onDismissed: () => void }) =>
      opts.onDismissed()
    );
    mount();
    await screen.findByRole('listitem', { name: /github-actions/ });
    await userEvent.click(screen.getByRole('button', { name: 'Create token' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /verify with your authenticator.*last 5 minutes/i
    );
    expect(screen.queryByRole('region', { name: 'New deploy token' })).toBeNull();
  });

  it('rotates a token after a confirm and shows the replacement once', async () => {
    const post = spyApi('POST').mockResolvedValue(
      ok(
        {
          token: { ...active, id: 'next', rotated_from_id: active.id },
          token_plaintext: SECRET,
          old_token_id: active.id,
        },
        201
      ) as never
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Rotate github-actions' }));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/stops working immediately/) })
    );
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/deploy-tokens/{id}/rotate', {
        params: { path: { slug: 'alpha', id: active.id } },
        body: {},
      })
    );
    const reveal = await screen.findByRole('region', { name: 'Deploy token rotated' });
    await userEvent.click(within(reveal).getByRole('button', { name: 'Reveal' }));
    expect(reveal).toHaveTextContent(SECRET);
  });

  it('does not rotate when the confirm is cancelled', async () => {
    mocks.confirm.mockResolvedValue(false);
    const post = spyApi('POST');
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Rotate github-actions' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(post).not.toHaveBeenCalled();
  });

  it('revokes through a destructive confirm', async () => {
    const del = spyApi('DELETE').mockResolvedValue(ok(undefined, 204) as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke github-actions' }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('/v1/apps/{slug}/deploy-tokens/{id}', {
        params: { path: { slug: 'alpha', id: active.id } },
      })
    );
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }))
    );
  });

  it('reports an expired token on rotate by its code', async () => {
    spyApi('POST').mockResolvedValue(problem(401, 'api_key_expired') as never);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Rotate github-actions' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'error',
          description: expect.stringMatching(/expired.*create a new one/i),
        })
      )
    );
  });
});
