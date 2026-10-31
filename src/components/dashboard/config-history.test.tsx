import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigHistory } from './config-history';
import { spyApi } from '@/test/api';

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), toast: vi.fn() }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const problem = (status: number, code: string) =>
  ({
    error: { type: 'about:blank', title: code, status, code, detail: `${code} detail` },
    response: new Response(null, { status }),
  }) as never;

const revisions = [
  {
    revision: 5,
    scope: 'default',
    source: 'env.set',
    key: 'REGION',
    actor: 'ada@example.com',
    created_at: '2026-10-31T09:58:00Z',
    variable_count: 4,
    secret_count: 2,
    guard_id: 'g-2',
    guard_status: 'watching',
  },
  {
    revision: 4,
    scope: 'default',
    source: 'secret.rotate',
    key: 'DATABASE_URL',
    actor: 'ada@example.com',
    created_at: '2026-10-30T09:00:00Z',
    variable_count: 3,
    secret_count: 2,
  },
  {
    revision: 3,
    scope: 'default',
    source: 'config.guard_restore',
    actor: 'gregale',
    created_at: '2026-10-29T09:00:00Z',
    variable_count: 3,
    secret_count: 2,
    restored_revision: 2,
  },
];

const details: Record<number, unknown> = {
  5: {
    ...revisions[0],
    variables: { LOG_LEVEL: 'secret-looking-info', REGION: 'eu-west', EXTRA: 'x-value' },
    secret_versions: { DATABASE_URL: 2, STRIPE_KEY: 1 },
  },
  3: {
    ...revisions[2],
    variables: { LOG_LEVEL: 'secret-looking-info', REGION: 'eu-central', OLD_FLAG: 'on' },
    secret_versions: { DATABASE_URL: 1, STRIPE_KEY: 1 },
  },
};

const watching = {
  id: 'g-2',
  scope: 'default',
  status: 'watching',
  base_revision: 4,
  head_revision: 5,
  restorable: true,
  opened_at: '2026-10-31T09:58:00Z',
  last_change_at: '2026-10-31T09:58:00Z',
};

let guardResponse: unknown;
let revisionsResponse: unknown;

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConfigHistory slug="checkout" />
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.toast.mockReset();
  guardResponse = ok(watching);
  revisionsResponse = ok({ revisions, guard: watching });
  spyApi('GET').mockImplementation(async (path, init) => {
    const params = (init as { params?: { path?: Record<string, unknown> } })?.params?.path ?? {};
    if (path === '/v1/apps/{slug}/config/guard') return guardResponse as never;
    if (path === '/v1/apps/{slug}/config/revisions') return revisionsResponse as never;
    if (path === '/v1/apps/{slug}/config/revisions/{revision}')
      return details[Number(params.revision)]
        ? ok(details[Number(params.revision)])
        : problem(404, 'config_revision_not_found');
    if (path === '/v1/apps/{slug}/env')
      return ok({
        env: ['LOG_LEVEL', 'REGION', 'EXTRA'].map((key) => ({
          key,
          scope: 'default',
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
        })),
        count: 3,
        quota_max: 128,
      });
    throw new Error(`unexpected GET ${path}`);
  });
});

describe('config guard', () => {
  it('explains a watching guard and what the customer needs to do', async () => {
    mount();
    const guard = await screen.findByRole('region', { name: 'Config guard' });
    await waitFor(() => expect(guard).toHaveTextContent(/waiting for the first request/i));
    expect(guard).toHaveTextContent('Watching');
    expect(guard).toHaveTextContent(/restores the previous values/i);
  });

  it('shows the decision samples of a restored guard', async () => {
    guardResponse = ok({
      ...watching,
      status: 'restored',
      closed_at: '2026-10-31T10:05:00Z',
      decision: {
        rule: 'fail_first_wake_5xx',
        summary: '7 of 9 requests with the new config answered 5xx',
        new_requests: 9,
        new_server_errors: 7,
        old_requests: 412,
        old_server_errors: 1,
        restored_revision: 4,
      },
    });
    mount();
    const guard = await screen.findByRole('region', { name: 'Config guard' });
    await waitFor(() => expect(guard).toHaveTextContent(/restored revision 4/));
    expect(guard).toHaveTextContent('7 of 9 5xx');
    expect(guard).toHaveTextContent('1 of 412 5xx');
  });

  it('says no change has been guarded when the scope has no guard', async () => {
    guardResponse = problem(404, 'config_guard_not_found');
    mount();
    const guard = await screen.findByRole('region', { name: 'Config guard' });
    await waitFor(() => expect(guard).toHaveTextContent(/No change has been guarded yet/));
    expect(guard).not.toHaveTextContent('config_guard_not_found detail');
  });

  it('shows other guard errors', async () => {
    guardResponse = problem(503, 'capacity_unavailable');
    mount();
    const guard = await screen.findByRole('region', { name: 'Config guard' });
    await waitFor(() => expect(guard).toHaveTextContent('capacity_unavailable detail'));
  });
});

describe('config history', () => {
  it('lists revisions by key, actor and guard verdict, without values', async () => {
    mount();
    const history = await screen.findByRole('region', { name: 'Revisions' });
    await waitFor(() => expect(history).toHaveTextContent('Set REGION'));
    expect(history).toHaveTextContent('Rotated secret DATABASE_URL');
    expect(history).toHaveTextContent('Config guard restored revision 2');
    expect(history).toHaveTextContent('ada@example.com');
    expect(history).toHaveTextContent('#5');
    expect(history).not.toHaveTextContent('eu-west');
    // The newest revision is the current config; there is nothing to roll back to.
    expect(within(history).queryByRole('button', { name: 'Roll back to revision 5' })).toBeNull();
    expect(within(history).getByRole('button', { name: 'Roll back to revision 3' })).toBeEnabled();
  });

  it('says when nothing has been recorded yet', async () => {
    revisionsResponse = ok({ revisions: [] });
    mount();
    const history = await screen.findByRole('region', { name: 'Revisions' });
    await waitFor(() => expect(history).toHaveTextContent(/No config changes recorded yet/));
  });
});

describe('config rollback', () => {
  it('reviews the keys a rollback changes, confirms, and offers a restart', async () => {
    const post = spyApi('POST').mockImplementation(async (path) => {
      if (path === '/v1/apps/{slug}/config/rollback')
        return ok({
          restored_revision: 3,
          set: ['OLD_FLAG', 'REGION'],
          deleted: ['EXTRA'],
          change: {
            revision: 6,
            guard: { id: 'g-3', status: 'watching', base_revision: 5, window_minutes: 10 },
          },
          secrets_not_restored: [{ key: 'DATABASE_URL', target_version: 1, current_version: 2 }],
        });
      if (path === '/v1/apps/{slug}/restart')
        return ok({ wake_id: 'wake-0123456789ab', parked: 1 });
      throw new Error(`unexpected POST ${path}`);
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Roll back to revision 3' }));

    const review = await screen.findByRole('region', { name: 'Roll back to revision 3' });
    await waitFor(() => expect(review).toHaveTextContent('Sets OLD_FLAG, REGION'));
    expect(review).toHaveTextContent('Deletes EXTRA');
    expect(review).toHaveTextContent(/DATABASE_URL.*version 1.*now 2/);
    expect(review).not.toHaveTextContent('eu-central');
    expect(review).not.toHaveTextContent('secret-looking-info');

    await userEvent.click(within(review).getByRole('button', { name: 'Roll back' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/v1/apps/{slug}/config/rollback',
        expect.objectContaining({
          params: { path: { slug: 'checkout' } },
          body: { revision: 3 },
        })
      )
    );
    const asked = mocks.confirm.mock.calls[0][0];
    expect(asked).toMatchObject({ destructive: true });
    expect(asked.description).toMatch(/Sets OLD_FLAG and REGION and deletes EXTRA/);
    expect(asked.description).toMatch(/until they restart/);

    const result = await screen.findByRole('region', { name: 'Rollback result' });
    expect(result).toHaveTextContent('Restored the variables of revision 3 as revision 6');
    expect(result).toHaveTextContent(/watches the first 10 minutes/);
    expect(result).toHaveTextContent(/DATABASE_URL.*set it again/);
    await userEvent.click(within(result).getByRole('button', { name: 'Restart now' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/restart', expect.anything())
    );
  });

  it('does nothing when the confirm is declined', async () => {
    mocks.confirm.mockResolvedValue(false);
    const post = spyApi('POST');
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Roll back to revision 3' }));
    const review = await screen.findByRole('region', { name: 'Roll back to revision 3' });
    await waitFor(() => expect(review).toHaveTextContent('Deletes EXTRA'));
    await userEvent.click(within(review).getByRole('button', { name: 'Roll back' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(post).not.toHaveBeenCalled();
  });

  it('explains a pruned revision by its code', async () => {
    spyApi('POST').mockResolvedValue(problem(404, 'config_revision_not_found'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Roll back to revision 3' }));
    const review = await screen.findByRole('region', { name: 'Roll back to revision 3' });
    await waitFor(() => expect(review).toHaveTextContent('Deletes EXTRA'));
    await userEvent.click(within(review).getByRole('button', { name: 'Roll back' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Revision 3 is no longer kept' })
      )
    );
  });

  it('explains a Git-managed variable by its code', async () => {
    spyApi('POST').mockResolvedValue(problem(409, 'environment_field_git_managed'));
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Roll back to revision 3' }));
    const review = await screen.findByRole('region', { name: 'Roll back to revision 3' });
    await waitFor(() => expect(review).toHaveTextContent('Deletes EXTRA'));
    await userEvent.click(within(review).getByRole('button', { name: 'Roll back' }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Managed by Git' })
      )
    );
  });
});
