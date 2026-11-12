import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from '@/test/api';
import { JobRegistryCredentialsPanel, RegistryCredentialsPanel } from './registry-credentials';

const ok = (data: unknown) => Promise.resolve({ data, response: new Response() });
const problem = (status: number, code: string, detail: string) =>
  Promise.resolve({
    error: { type: 'about:blank', title: code, status, code, detail },
    response: new Response(null, { status }),
  });

function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>{children}</ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const credential = {
  registry: 'ghcr.io',
  username: 'deploy-bot',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-02T00:00:00Z',
};

afterEach(() => vi.restoreAllMocks());

it("lists a job's own registries from its route, never a password", async () => {
  const get = spyApi('GET').mockImplementation(() =>
    ok({ credentials: [credential], quota_max: 5, count: 1 })
  );
  mount(<JobRegistryCredentialsPanel name="nightly-export" />);
  expect(await screen.findByText('ghcr.io')).toBeInTheDocument();
  expect(screen.getByText(/deploy-bot/)).toBeInTheDocument();
  expect(screen.getByText(/Up to 5 registries/)).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/v1/jobs/{name}/registry-credentials', {
    params: { path: { name: 'nightly-export' } },
  });
});

it('saves a credential for the job', async () => {
  spyApi('GET').mockImplementation(() => ok({ credentials: [], quota_max: 5, count: 0 }));
  const put = spyApi('PUT').mockImplementation(() => ok(credential));
  mount(<JobRegistryCredentialsPanel name="nightly-export" />);
  expect(await screen.findByText(/No private registry credentials/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Add registry' }));
  const url = screen.getByPlaceholderText('https://registry.example.com');
  await userEvent.clear(url);
  await userEvent.type(url, 'https://ghcr.io');
  await userEvent.type(screen.getByLabelText('Username'), 'deploy-bot');
  await userEvent.type(screen.getByLabelText('Password'), 's3cret');
  await userEvent.click(screen.getByRole('button', { name: 'Save credential' }));
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/v1/jobs/{name}/registry-credentials', {
      params: { path: { name: 'nightly-export' } },
      body: { registry: 'https://ghcr.io', username: 'deploy-bot', password: 's3cret' },
    })
  );
  expect(await screen.findByText('Registry credential saved')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Add registry' }));
  expect(screen.getByLabelText('Password')).toHaveValue('');
});

it('removes a credential after asking, sending the host with https://', async () => {
  spyApi('GET').mockImplementation(() => ok({ credentials: [credential], quota_max: 5, count: 1 }));
  const del = spyApi('DELETE').mockImplementation(() => ok(undefined));
  mount(<JobRegistryCredentialsPanel name="nightly-export" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Remove ghcr.io' }));
  const dialog = await screen.findByRole('dialog');
  expect(del).not.toHaveBeenCalled();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Remove credential' }));
  await waitFor(() =>
    expect(del).toHaveBeenCalledWith('/v1/jobs/{name}/registry-credentials', {
      params: { path: { name: 'nightly-export' }, query: { registry: 'https://ghcr.io' } },
    })
  );
});

it('shows a refused save with its code', async () => {
  spyApi('GET').mockImplementation(() => ok({ credentials: [], quota_max: 5, count: 0 }));
  spyApi('PUT').mockImplementation(() =>
    problem(413, 'plan_job_registry_credential_quota', 'this job already has 5 registries')
  );
  mount(<JobRegistryCredentialsPanel name="nightly-export" />);
  await screen.findByText(/No private registry credentials/);
  await userEvent.click(screen.getByRole('button', { name: 'Add registry' }));
  await userEvent.type(screen.getByLabelText('Username'), 'bot');
  await userEvent.type(screen.getByLabelText('Password'), 'pw');
  await userEvent.clear(screen.getByPlaceholderText('https://registry.example.com'));
  await userEvent.type(screen.getByPlaceholderText('https://registry.example.com'), 'https://x.io');
  await userEvent.click(screen.getByRole('button', { name: 'Save credential' }));
  expect(await screen.findByText('Could not save credential')).toBeInTheDocument();
  expect(screen.getByText('plan_job_registry_credential_quota')).toBeInTheDocument();
});

it("keeps the app's registries on the app's route", async () => {
  const get = spyApi('GET').mockImplementation(() =>
    ok({ credentials: [credential], quota_max: 20, count: 1 })
  );
  mount(<RegistryCredentialsPanel slug="api" />);
  expect(await screen.findByText('ghcr.io')).toBeInTheDocument();
  expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/registry-credentials', {
    params: { path: { slug: 'api' } },
  });
});
