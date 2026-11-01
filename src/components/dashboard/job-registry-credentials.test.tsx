import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';

const confirm = vi.fn();
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { JobRegistryCredentials } = await import('./job-registry-credentials');

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const noContent = () =>
  Promise.resolve({ data: undefined, response: new Response(null, { status: 204 }) });
const problem = (status: number, code: string, detail: string, extra = {}) =>
  Promise.resolve({
    error: { type: 'about:blank', title: code, status, code, detail, ...extra },
    response: new Response(null, { status }),
  });

const credential = {
  registry: 'ghcr.io',
  username: 'acme-bot',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
  last_used_at: '2026-10-31T00:00:00Z',
};
const list = (credentials = [credential]) => ({
  credentials,
  quota_max: 5,
  count: credentials.length,
});

function mount(children: ReactNode = <JobRegistryCredentials name="nightly-export" />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

async function fill(registry: string) {
  await userEvent.clear(screen.getByLabelText('Registry URL'));
  await userEvent.type(screen.getByLabelText('Registry URL'), registry);
  await userEvent.type(screen.getByLabelText('Username'), 'acme-bot');
  await userEvent.type(screen.getByLabelText('Password'), 's3cret-token');
}

beforeEach(() => confirm.mockReset().mockResolvedValue(true));
afterEach(() => vi.restoreAllMocks());

describe('JobRegistryCredentials', () => {
  it('lists each registry with its username and quota, never a password', async () => {
    spyApi('GET').mockImplementation(() => ok(list()));
    mount();
    expect(await screen.findByText('ghcr.io')).toBeInTheDocument();
    expect(screen.getByText(/acme-bot/)).toBeInTheDocument();
    expect(screen.getByText('1 of 5 registries for this workload')).toBeInTheDocument();
  });

  it('says when the workload has none', async () => {
    spyApi('GET').mockImplementation(() => ok(list([])));
    mount();
    expect(await screen.findByText(/no private registry credentials/i)).toBeInTheDocument();
  });

  it('takes the password write-only and clears it once sealed', async () => {
    spyApi('GET').mockImplementation(() => ok(list([])));
    const put = spyApi('PUT').mockImplementation(() => ok(credential));
    mount();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
    await fill('https://ghcr.io');
    await userEvent.click(screen.getByRole('button', { name: 'Save credential' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/v1/jobs/{name}/registry-credentials', {
        params: { path: { name: 'nightly-export' } },
        body: { registry: 'https://ghcr.io', username: 'acme-bot', password: 's3cret-token' },
      })
    );
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveValue(''));
  });

  it('asks for the https:// prefix apid requires instead of sending a bare host', async () => {
    spyApi('GET').mockImplementation(() => ok(list([])));
    const put = spyApi('PUT');
    mount();
    await fill('ghcr.io');
    await userEvent.click(screen.getByRole('button', { name: 'Save credential' }));
    expect(screen.getByText(/start the registry url with https:\/\//i)).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("states the plan's per-workload cap when it is reached", async () => {
    spyApi('GET').mockImplementation(() => ok(list()));
    spyApi('PUT').mockImplementation(() =>
      problem(413, 'plan_job_registry_credential_quota', 'the pro plan caps …', {
        limit: 5,
        observed: 5,
      })
    );
    mount();
    await fill('https://quay.io');
    await userEvent.click(screen.getByRole('button', { name: 'Save credential' }));
    expect(
      await screen.findByText(/allows 5 registry credentials per workload/i)
    ).toBeInTheDocument();
  });

  it('removes a credential by its https:// URL after naming what stops', async () => {
    spyApi('GET').mockImplementation(() => ok(list()));
    const del = spyApi('DELETE').mockImplementation(noContent);
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove ghcr.io' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Remove ghcr.io from nightly-export?',
        destructive: true,
      })
    );
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith('/v1/jobs/{name}/registry-credentials', {
        params: { path: { name: 'nightly-export' }, query: { registry: 'https://ghcr.io' } },
      })
    );
  });

  it('treats a credential already gone as removed', async () => {
    spyApi('GET').mockImplementation(() => ok(list()));
    spyApi('DELETE').mockImplementation(() =>
      problem(400, 'job_registry_credential_not_found', 'no credential stored')
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove ghcr.io' }));
    expect(await screen.findByText('Already removed')).toBeInTheDocument();
  });
});
