import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { sampleVersion, type OnboardingDraft } from '@/lib/onboarding-draft';
import { OnboardingRecovery } from './onboarding-recovery';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/components/dashboard/deployment-progress', () => ({
  DeploymentProgress: () => <p>Actual build progress</p>,
}));
vi.mock('@/lib/tar', () => ({
  tarball: () => new Uint8Array(),
  gzip: async () => new Blob(['sample']),
}));

const app = {
  id: 'app-1',
  slug: 'hello-sample',
  url: 'https://hello-sample.example',
  type: 'function',
  runtime: 'node24',
  visibility: 'public',
};
const deployment = { id: 'a'.repeat(32), app_id: app.id, status: 'live' };
const owner = { account: 'account-a', workspace: null };
const draft: OnboardingDraft = {
  kind: 'sample',
  starter: sampleVersion(),
  app: app.slug,
  deployment: deployment.id,
  phase: 'accepted',
};
afterEach(() => vi.restoreAllMocks());

function responses({
  fail = false,
  mismatch = false,
}: { fail?: boolean; mismatch?: boolean } = {}) {
  return spyApi('GET').mockImplementation(async (path) => {
    if (fail) throw new TypeError('offline');
    const data =
      path === '/v1/apps/{slug}'
        ? app
        : path === '/v1/deployments/{id}'
          ? { ...deployment, app_id: mismatch ? 'other-app' : app.id }
          : { items: [deployment] };
    return { data, response: new Response() } as never;
  });
}
function setup(
  initial = draft,
  options: { unavailable?: boolean; cached?: boolean; account?: string } = {}
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 3, retryDelay: 0 } },
  });
  const actor = { ...owner, account: options.account ?? owner.account };
  if (options.cached) {
    client.setQueryData(['apps', 'account', actor.account, app.slug], app);
    client.setQueryData(['deployments', 'account', actor.account, deployment.id], deployment);
  }
  const changed = vi.fn();
  function View() {
    const [saved, setSaved] = useState(initial);
    return (
      <OnboardingRecovery
        owner={actor}
        draft={saved}
        apps={[app] as never}
        inventoryUnavailable={options.unavailable}
        onChange={(next) => {
          changed(next);
          setSaved(next);
        }}
        onRefresh={vi.fn()}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <View />
    </QueryClientProvider>
  );
  return { client, changed, ...view };
}
it('requires a fresh matching live read and gives Free customers a public URL/curl without invoking', async () => {
  responses();
  const post = spyApi('POST');
  setup();
  expect(await screen.findByRole('heading', { name: 'Your app is live' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open app' })).toHaveAttribute('href', `${app.url}/`);
  expect(screen.getByRole('button', { name: /curl command/ })).toBeVisible();
  expect(post).not.toHaveBeenCalled();
});
it('does not announce cached success while the required fresh read fails', async () => {
  responses({ fail: true });
  setup(draft, { cached: true });
  expect(screen.queryByRole('heading', { name: 'Your app is live' })).not.toBeInTheDocument();
  await screen.findByRole('button', { name: 'Retry status check' });
  expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
});
it('blocks a saved deployment that belongs to a different app', async () => {
  responses({ mismatch: true });
  const post = spyApi('POST');
  setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('does not belong to this app');
  expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
it('blocks completion and mutations when workspace inventory could not be confirmed', async () => {
  responses();
  const post = spyApi('POST');
  setup(draft, { unavailable: true });
  await screen.findByRole('button', { name: 'Retry app lookup' });
  expect(screen.queryByRole('heading', { name: 'Your app is live' })).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
it('requires explicit selection from actual history after an unknown submission', async () => {
  responses();
  const post = spyApi('POST');
  const { changed } = setup({ ...draft, phase: 'unknown', deployment: undefined });
  await screen.findByRole('button', { name: 'Use this deployment' });
  expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use this deployment' }));
  await screen.findByRole('heading', { name: 'Your app is live' });
  expect(changed).toHaveBeenCalledWith(
    expect.objectContaining({ deployment: deployment.id, phase: 'accepted' })
  );
  expect(post).not.toHaveBeenCalled();
});
it('does not replay a sample upload even when the QueryClient defaults retry mutations', async () => {
  responses();
  const post = spyApi('POST').mockRejectedValue(new TypeError('lost response'));
  const { changed } = setup({ ...draft, phase: 'rejected', deployment: undefined });
  fireEvent.click(await screen.findByRole('button', { name: 'Deploy sample to saved app' }));
  await screen.findByRole('heading', { name: 'Check your deployment outcome' });
  expect(post).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: 'unknown', app: app.slug })
  );
});
it('does not replace the saved starter version while restoring rejected source', async () => {
  responses();
  setup({
    ...draft,
    kind: 'sample',
    starter: 'node-old',
    phase: 'rejected',
    deployment: undefined,
  });
  await screen.findByText(/This sample version has changed/);
  expect(
    screen.queryByRole('button', { name: 'Deploy sample to saved app' })
  ).not.toBeInTheDocument();
});
it('keeps different actors in different query families', async () => {
  responses();
  const { client } = setup(draft, { account: 'account-b' });
  await screen.findByRole('heading', { name: 'Your app is live' });
  expect(
    client.getQueryData(['deployments', 'account', 'account-a', deployment.id])
  ).toBeUndefined();
  expect(client.getQueryData(['deployments', 'account', 'account-b', deployment.id])).toMatchObject(
    deployment
  );
});

it('prepares another source submission only after explicit inspection, without sending it', async () => {
  spyApi('GET').mockImplementation(
    async (path) =>
      ({
        data: path === '/v1/apps/{slug}' ? app : { items: [] },
        response: new Response(),
      }) as never
  );
  const post = spyApi('POST');
  const { changed } = setup({ ...draft, phase: 'unknown', deployment: undefined });
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare another submission' }));
  await screen.findByRole('button', { name: 'Deploy sample to saved app' });
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ phase: 'rejected', app: app.slug })
  );
  expect(post).not.toHaveBeenCalled();
});
it('allows leaving an inspected unknown creation without automatically creating an app', async () => {
  responses();
  const post = spyApi('POST');
  const { changed } = setup({
    ...draft,
    name: 'missing-sample',
    app: undefined,
    deployment: undefined,
    phase: 'unknown',
  });
  fireEvent.click(await screen.findByRole('button', { name: 'I checked — return to setup' }));
  await waitFor(() =>
    expect(changed).toHaveBeenLastCalledWith(
      expect.objectContaining({ phase: 'preparing', name: 'missing-sample' })
    )
  );
  expect(post).not.toHaveBeenCalled();
});
