import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { spyApi } from '@/test/api';
import { RecentlyDeletedApps } from './recently-deleted-apps';

const toast = vi.fn();
const navigate = vi.fn();
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account-a' } }) }));

const evaluated = '2026-10-31T12:00:00Z';
const eligible = {
  account_id: 'account-a',
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'checkout-preview',
  deleted_at: '2026-10-31T10:00:00Z',
  delete_grace_until: '2026-11-07T10:00:00Z',
  restore_eligible: true,
  restore_blocker: '' as const,
  evaluated_at: evaluated,
};
const expired = {
  ...eligible,
  id: '00000000-0000-4000-8000-000000000002',
  slug: 'legacy-cron',
  deleted_at: '2026-10-22T09:00:00Z',
  delete_grace_until: '2026-10-29T09:00:00Z',
  restore_eligible: false,
  restore_blocker: 'grace_expired' as const,
};

function ok(data: unknown) {
  return Promise.resolve({ data, response: new Response() });
}
function problem(status: number, code: string, detail = 'server prose') {
  return Promise.resolve({
    error: { status, code, title: code, detail },
    response: new Response(null, { status }),
  });
}

function page(apps: unknown[], next_cursor?: string) {
  return { account_id: 'account-a', apps, evaluated_at: evaluated, next_cursor };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <RecentlyDeletedApps />
      </ConfirmProvider>
    </QueryClientProvider>
  );
  return client;
}

beforeEach(() => {
  toast.mockReset();
  navigate.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('RecentlyDeletedApps', () => {
  it('shows a loading state while the inventory is read', () => {
    spyApi('GET').mockImplementation(() => new Promise(() => {}));
    mount();
    expect(screen.getByRole('status')).toHaveTextContent(/loading recently deleted apps/i);
  });

  it('says how far back the inventory reaches when it is empty', async () => {
    spyApi('GET').mockImplementation(() => ok(page([])));
    mount();
    expect(await screen.findByText('No apps deleted in the last 7 days.')).toBeInTheDocument();
  });

  it('reads the account inventory and lists name, deletion and restore deadline', async () => {
    const get = spyApi('GET').mockImplementation(() => ok(page([eligible, expired])));
    mount();
    const row = (await screen.findByText('checkout-preview')).closest('li')!;
    expect(get).toHaveBeenCalledWith(
      '/v1/deleted-apps',
      expect.objectContaining({ params: { query: { limit: 25 } } })
    );
    expect(within(row).getByText(/deleted/i)).toBeInTheDocument();
    // The window is measured from the server's evaluation time, not the browser clock.
    expect(within(row).getByText(/6 days left/)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Restore checkout-preview' })).toBeEnabled();

    const gone = screen.getByText('legacy-cron').closest('li')!;
    expect(within(gone).getByText(/restore window has closed/i)).toBeInTheDocument();
    expect(within(gone).queryByRole('button', { name: /restore/i })).not.toBeInTheDocument();
  });

  it('explains purge and missing metadata without offering a restore', async () => {
    spyApi('GET').mockImplementation(() =>
      ok(
        page([
          { ...expired, slug: 'purging', restore_blocker: 'purge_started' },
          {
            ...expired,
            id: '00000000-0000-4000-8000-000000000003',
            slug: 'legacy-row',
            deleted_at: null,
            delete_grace_until: null,
            restore_blocker: 'metadata_unavailable',
          },
        ])
      )
    );
    mount();
    expect(await screen.findByText(/permanent removal has started/i)).toBeInTheDocument();
    expect(screen.getByText(/deletion time was not recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^restore/i })).not.toBeInTheDocument();
  });

  it('loads the next page through the opaque cursor', async () => {
    const get = spyApi('GET').mockImplementation((_path, init) => {
      const cursor = (init as { params: { query: { cursor?: string } } }).params.query.cursor;
      return ok(cursor === 'opaque-2' ? page([expired]) : page([eligible], 'opaque-2'));
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }));
    expect(await screen.findByText('legacy-cron')).toBeInTheDocument();
    expect(get).toHaveBeenLastCalledWith(
      '/v1/deleted-apps',
      expect.objectContaining({ params: { query: { limit: 25, cursor: 'opaque-2' } } })
    );
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('shows a read failure with a way to retry', async () => {
    spyApi('GET').mockImplementation(() => problem(503, 'capacity_unavailable', 'try later'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('try later');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('restores by exact ID after a confirm, then opens the app with a toast', async () => {
    spyApi('GET').mockImplementation(() => ok(page([eligible])));
    const post = spyApi('POST').mockImplementation(() =>
      ok({ id: eligible.id, slug: 'checkout-preview', status: 'undeployed' })
    );
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Restore checkout-preview' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Restore checkout-preview?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore app' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith('/v1/deleted-apps/{id}/restore', {
        params: { path: { id: eligible.id } },
      })
    );
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith({
        to: '/dashboard/apps/$appSlug',
        params: { appSlug: 'checkout-preview' },
      })
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Restored checkout-preview' })
    );
  });

  it('sends nothing when the confirm is cancelled', async () => {
    spyApi('GET').mockImplementation(() => ok(page([eligible])));
    const post = spyApi('POST');
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Restore checkout-preview' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })
    );
    expect(post).not.toHaveBeenCalled();
  });

  const cases: [string, number, RegExp][] = [
    ['not_found', 404, /no longer in your recently deleted apps/i],
    ['app_not_restorable', 409, /can no longer be restored/i],
    ['conflict', 409, /another app now uses the name checkout-preview/i],
    ['plan_limit_apps', 403, /delete an app you no longer use or upgrade your plan/i],
    ['plan_limit_developer_apps', 403, /gregale dev --stop/],
    ['org_role_forbidden', 403, /owner or admin/i],
    ['insufficient_scope', 403, /reactivate/i],
    ['mfa_required', 403, /two-factor/i],
    ['billing_past_due', 402, /billing/i],
    ['capacity_unavailable', 503, /check the list before trying again/i],
    ['api_rate_limited', 429, /wait a minute/i],
    ['traffic_policy_too_large', 409, /traffic policy/i],
    ['traffic_policy_too_complex', 409, /traffic policy/i],
    ['validation_failed', 400, /refresh the page/i],
    // Nothing coherent answered, so the outcome is unknown.
    ['http_502', 502, /may have gone through; check the list/i],
  ];
  it.each(cases)('explains %s in terms of what to do next', async (code, status, message) => {
    spyApi('GET').mockImplementation(() => ok(page([eligible])));
    const post = spyApi('POST').mockImplementation(() => problem(status, code));
    const client = mount();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(await screen.findByRole('button', { name: 'Restore checkout-preview' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore app' })
    );
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'error',
          title: 'Could not restore checkout-preview',
          description: expect.stringMatching(message),
        })
      )
    );
    // Never retried: the route has no replay receipt. The inventory is re-read instead.
    expect(post).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['account', 'deleted-apps'] });
    expect(navigate).not.toHaveBeenCalled();
  });
});
