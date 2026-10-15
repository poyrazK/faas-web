import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageDeployForm } from './image-deploy-form';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import { readImageOperation, saveImageOperation, newImageOperation } from '@/lib/image-operation';
const state = vi.hoisted(() => ({
  account: { id: 'a', plan: 'free', limits: { ram_mb: 128 }, app_count: 0 },
  availability: 'available',
  terminal: '',
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: state.account }) }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({ state: state.availability, refresh: vi.fn() }),
}));
vi.mock('./deployment-progress', () => ({
  DeploymentProgress: ({
    deploymentId,
    onTerminal,
  }: {
    deploymentId: string;
    onTerminal?: (deployment: never) => void;
  }) => (
    <div>
      Release {deploymentId}
      {state.terminal && (
        <button
          onClick={() =>
            onTerminal?.({ id: deploymentId, app_id: 'app-1', status: state.terminal } as never)
          }
        >
          Read confirmed terminal status
        </button>
      )}
    </div>
  ),
}));
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: vi.fn() }));
const reference = `ghcr.io/team/api@sha256:${'a'.repeat(64)}`;
function mount(slug?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ImageDeployForm slug={slug} />
    </QueryClientProvider>
  );
}
const ok = (data: unknown) => ({ data, response: new Response() }) as never;
beforeEach(() => {
  localStorage.clear();
  state.account.id = 'a';
  state.account.plan = 'free';
  state.availability = 'available';
  state.terminal = '';
  vi.spyOn(api, 'GET').mockImplementation(async (path) =>
    path === '/v1/apps/{slug}'
      ? ok({ id: 'app-1', slug: 'my-api', type: 'app' })
      : ok({ credentials: [], count: 0, quota_max: 0 })
  );
});
it.each(['free', 'hobby'])(
  'inherits the %s plan idle timeout rather than sending an inadmissible override',
  async (plan) => {
    state.account.plan = plan;
    vi.spyOn(api, 'POST').mockImplementation(async (path, options) => {
      if (path === '/v1/apps') {
        const timeout =
          (options as { body?: { idle_timeout_s?: number } } | undefined)?.body?.idle_timeout_s ??
          0;
        if (timeout !== 0 && (timeout < 10 || timeout > 120))
          return {
            error: { title: 'Idle timeout rejected', code: 'validation_failed' },
            response: new Response(null, { status: 422 }),
          } as never;
        return ok({ id: 'app-1', slug: 'my-api' });
      }
      return ok({ id: 'dep-1' });
    });
    mount();
    await review();
    await userEvent.click(screen.getByRole('button', { name: 'Create app and deploy image' }));
    expect(await screen.findByText('Release dep-1')).toBeInTheDocument();
  }
);
it.each([422, 409])(
  'corrects a definitive initial %s slug rejection after reload using a new creation key',
  async (rejection) => {
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValueOnce(
        new ApiError({ status: rejection, code: 'validation_failed', title: 'Reserved slug' })
      )
      .mockImplementation(async (path) =>
        path === '/v1/apps' ? ok({ id: 'app-1', slug: 'my-api' }) : ok({ id: 'dep-1' })
      );
    mount();
    await userEvent.type(screen.getByLabelText('App name'), 'api');
    await userEvent.type(screen.getByLabelText('Image reference'), reference);
    await userEvent.click(screen.getByRole('button', { name: 'Review image deployment' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create app and deploy image' }));
    await screen.findByText('Reserved slug');
    const original = readImageOperation('a', '')!;
    cleanup();
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Edit rejected request' }));
    await userEvent.clear(screen.getByLabelText('App name'));
    await userEvent.type(screen.getByLabelText('App name'), 'my-api');
    await userEvent.click(screen.getByRole('button', { name: 'Review image deployment' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create app and deploy image' }));
    await screen.findByText('Release dep-1');
    expect(readImageOperation('a', '')?.createKey).not.toBe(original.createKey);
    expect(post).toHaveBeenCalledTimes(3);
  }
);
it('corrects a definitively rejected image payload without recreating its accepted app', async () => {
  const post = vi
    .spyOn(api, 'POST')
    .mockResolvedValueOnce(ok({ id: 'app-1', slug: 'my-api' }))
    .mockRejectedValueOnce(
      new ApiError({ status: 422, code: 'validation_failed', title: 'Image override rejected' })
    )
    .mockResolvedValue(ok({ id: 'dep-2' }));
  mount();
  await review();
  await userEvent.click(screen.getByRole('button', { name: 'Create app and deploy image' }));
  await screen.findByText('Image override rejected');
  const rejected = readImageOperation('a', '')!;
  cleanup();
  mount();
  await userEvent.click(screen.getByRole('button', { name: 'Edit rejected request' }));
  expect(screen.queryByLabelText('App name')).not.toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Image reference'));
  await userEvent.type(
    screen.getByLabelText('Image reference'),
    `ghcr.io/team/api@sha256:${'b'.repeat(64)}`
  );
  await userEvent.click(screen.getByRole('button', { name: 'Review image deployment' }));
  await userEvent.click(screen.getByRole('button', { name: 'Deploy reviewed image' }));
  await screen.findByText('Release dep-2');
  expect(post.mock.calls.filter((call) => call[0] === '/v1/apps')).toHaveLength(1);
  expect(readImageOperation('a', '')?.appId).toBe('app-1');
  expect(readImageOperation('a', '')?.deployKey).not.toBe(rejected.deployKey);
});
it.each(['failed', 'cancelled', 'superseded'])(
  'offers an explicit new image after reading a confirmed %s release following reload',
  async (status) => {
    const op = newImageOperation(
      'a',
      { slug: 'my-api', type: 'app' },
      { image: reference },
      'my-api'
    );
    saveImageOperation({ ...op, stage: 'accepted', appId: 'app-1', deploymentId: 'dep-old' });
    state.terminal = status;
    const post = vi.spyOn(api, 'POST').mockResolvedValue(ok({ id: 'dep-new' }));
    mount('my-api');
    expect(screen.queryByRole('button', { name: 'Choose another image' })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Read confirmed terminal status' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose another image' }));
    await userEvent.clear(screen.getByLabelText('Image reference'));
    await userEvent.type(
      screen.getByLabelText('Image reference'),
      `ghcr.io/team/api@sha256:${'b'.repeat(64)}`
    );
    await userEvent.click(screen.getByRole('button', { name: 'Review image deployment' }));
    await userEvent.click(screen.getByRole('button', { name: 'Deploy reviewed image' }));
    await screen.findByText('Release dep-new');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0]?.[0]).toBe('/v1/apps/{slug}/deployments');
    expect(readImageOperation('a', 'my-api')?.deployKey).not.toBe(op.deployKey);
  }
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function review() {
  await userEvent.type(screen.getByLabelText('App name'), 'my-api');
  await userEvent.type(screen.getByLabelText('Image reference'), reference);
  await userEvent.click(screen.getByRole('button', { name: 'Review image deployment' }));
}
it('deploys a public image without GitHub, persists before POST, and stores the accepted release', async () => {
  const post = vi.spyOn(api, 'POST').mockImplementation(async (path) => {
    const record = readImageOperation('a', '');
    expect(record).not.toBeNull();
    return path === '/v1/apps'
      ? ok({ id: 'app-1', slug: 'my-api', url: 'https://my-api.example' })
      : ok({ id: 'dep-1', app_id: 'app-1', status: 'pending' });
  });
  mount();
  await review();
  await userEvent.click(screen.getByRole('button', { name: 'Create app and deploy image' }));
  expect(await screen.findByText('Release dep-1')).toBeInTheDocument();
  expect(post).toHaveBeenCalledTimes(2);
  expect(post.mock.calls[1]?.[1]).toMatchObject({ body: { image: reference } });
  expect(readImageOperation('a', '')?.deploymentId).toBe('dep-1');
});
it('replays lost creation with the frozen original key after reload, without adopting a slug match', async () => {
  const post = vi
    .spyOn(api, 'POST')
    .mockRejectedValueOnce(new TypeError('lost'))
    .mockResolvedValueOnce(ok({ id: 'app-1', slug: 'my-api' }))
    .mockResolvedValueOnce(ok({ id: 'dep-1' }));
  mount();
  await review();
  await userEvent.click(screen.getByRole('button', { name: 'Create app and deploy image' }));
  await screen.findByText(/Could not reach the API/);
  const original = post.mock.calls[0];
  cleanup();
  mount();
  expect(screen.queryByLabelText('App name')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Recover app creation' }));
  expect(await screen.findByText('Release dep-1')).toBeInTheDocument();
  expect(post.mock.calls[1]).toEqual(original);
});
it.each(['failed', 'cancelled', 'superseded', 'deploying'])(
  'never resubmits automatically after an ambiguous %s deployment',
  async (status) => {
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValueOnce(ok({ id: 'app-1', slug: 'my-api' }))
      .mockRejectedValue(new TypeError('lost deployment'));
    const get = vi.spyOn(api, 'GET').mockImplementation(async (path) =>
      path === '/v1/apps/{slug}'
        ? ok({ id: 'app-1', slug: 'my-api', type: 'app' })
        : ok({
            items: [
              {
                id: 'candidate',
                app_id: 'app-1',
                image_digest: `@sha256:${'a'.repeat(64)}`,
                created_at: new Date().toISOString(),
                status,
              },
            ],
          })
    );
    mount();
    await review();
    await userEvent.click(screen.getByRole('button', { name: 'Create app and deploy image' }));
    await screen.findByText(/outcome is unconfirmed/);
    await userEvent.click(screen.getByRole('button', { name: 'Inspect recent releases' }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/deployments', expect.anything())
    );
    expect(await screen.findByText(status)).toBeInTheDocument();
    expect(post).toHaveBeenCalledTimes(2);
    expect(readImageOperation('a', '')?.appId).toBe('app-1');
    expect(readImageOperation('a', '')?.deploymentId).toBeUndefined();
  }
);
it('retains an app after credential failure and never persists the password', async () => {
  state.account.plan = 'scale';
  const post = vi.spyOn(api, 'POST').mockResolvedValue(ok({ id: 'app-1', slug: 'my-api' }));
  const put = vi.spyOn(api, 'PUT').mockRejectedValue(new Error('credential rejected'));
  mount();
  await userEvent.click(screen.getByLabelText('Add registry credentials'));
  await userEvent.type(screen.getByLabelText('Registry username'), 'alice');
  await userEvent.type(screen.getByLabelText('Registry password'), 'private-token');
  await review();
  await userEvent.click(screen.getByRole('button', { name: 'Create app and deploy image' }));
  await screen.findByText('credential rejected');
  expect(post).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledTimes(1);
  expect(readImageOperation('a', '')?.appId).toBe('app-1');
  expect(Object.values(localStorage).join(' ')).not.toContain('private-token');
});
it('stops creation recovery after expiry or conflict', async () => {
  const op = newImageOperation('a', { slug: 'my-api', type: 'app' }, { image: reference });
  saveImageOperation({ ...op, createdAt: Date.now() - 24 * 60 * 60 * 1000 });
  const post = vi.spyOn(api, 'POST');
  mount();
  expect(screen.getByRole('button', { name: 'Recover app creation' })).toBeDisabled();
  expect(screen.getByText(/receipt window has expired/)).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
it('blocks image submission when registry verification is unavailable', async () => {
  state.availability = 'registry-error';
  const post = vi.spyOn(api, 'POST');
  mount();
  expect(screen.getByRole('button', { name: 'Review image deployment' })).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});
it('recovers an accepted release by reads only and does not repeat a POST', () => {
  const op = newImageOperation('a', { slug: 'my-api', type: 'app' }, { image: reference });
  saveImageOperation({ ...op, stage: 'accepted', appId: 'app-1', deploymentId: 'dep-1' });
  const post = vi.spyOn(api, 'POST');
  mount();
  expect(screen.getByText('Release dep-1')).toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});
it('does not continue another account’s delayed creation into deployment', async () => {
  let finish!: (value: never) => void;
  const post = vi.spyOn(api, 'POST').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const view = mount();
  await review();
  await userEvent.click(screen.getByRole('button', { name: 'Create app and deploy image' }));
  state.account.id = 'b';
  view.rerender(
    <QueryClientProvider client={new QueryClient()}>
      <ImageDeployForm />
    </QueryClientProvider>
  );
  finish(ok({ id: 'app-1', slug: 'my-api' }));
  await waitFor(() => expect(screen.getByLabelText('App name')).toBeInTheDocument());
  expect(post).toHaveBeenCalledTimes(1);
  expect(readImageOperation('b', '')).toBeNull();
  expect(readImageOperation('a', '')?.stage).toBe('create-pending');
});
it.each([403, 422, 429])(
  'preserves frozen recovery after a %s rejection without automatic retry',
  async (status) => {
    const post = vi
      .spyOn(api, 'POST')
      .mockRejectedValue(new ApiError({ status, code: 'denied', title: 'Submission rejected' }));
    mount();
    await review();
    await userEvent.click(screen.getByRole('button', { name: 'Create app and deploy image' }));
    await screen.findByText('Submission rejected');
    expect(post).toHaveBeenCalledTimes(1);
    expect(readImageOperation('a', '')?.createRequest.slug).toBe('my-api');
    expect(screen.queryByLabelText('App name')).not.toBeInTheDocument();
  }
);
it('sends Free self-contained fallback only after explicit opt-in', async () => {
  const post = vi
    .spyOn(api, 'POST')
    .mockImplementation(async (path) =>
      path === '/v1/apps' ? ok({ id: 'app-1', slug: 'my-api' }) : ok({ id: 'dep-1' })
    );
  mount();
  await userEvent.click(screen.getByText('Advanced settings'));
  await userEvent.click(screen.getByLabelText('Allow self-contained image fallback'));
  await review();
  await userEvent.click(screen.getByRole('button', { name: 'Create app and deploy image' }));
  await screen.findByText('Release dep-1');
  expect(post.mock.calls[1]?.[1]).toMatchObject({ body: { full_rootfs_allow_auto: true } });
});
it('recovers an existing app setup by read without creating another app', async () => {
  const op = newImageOperation(
    'a',
    { slug: 'my-api', type: 'app' },
    { image: reference },
    'my-api'
  );
  saveImageOperation(op);
  const post = vi.spyOn(api, 'POST').mockResolvedValue(ok({ id: 'dep-1' }));
  mount('my-api');
  await userEvent.click(screen.getByRole('button', { name: 'Resume existing app deployment' }));
  await screen.findByText('Release dep-1');
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0]?.[0]).toBe('/v1/apps/{slug}/deployments');
});
