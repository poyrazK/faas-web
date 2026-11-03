import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import type { App } from '@/lib/api/queries';
import { spyApi } from '@/test/api';
import { SnapshotHooks } from './snapshot-hooks';

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  refresh: vi.fn(),
  access: 'on' as string,
  maturity: 'beta' as string | undefined,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({
    access: mocks.access,
    capability: mocks.maturity ? { key: id, maturity: mocks.maturity } : undefined,
    refresh: mocks.refresh,
  }),
}));

const bare = {
  id: 'app-1',
  slug: 'api-gateway',
  type: 'app',
  warm_snapshot_enabled: false,
  manifest: { entrypoint: ['node', 'server.js'], port: 8080 },
} as unknown as App;
const hooked = {
  ...bare,
  manifest: {
    ...bare.manifest,
    after_restore: { path: '/internal/after-restore', timeout_ms: 1500 },
  },
} as unknown as App;

const accepted = (body: object) => ({ data: body, response: new Response() }) as never;
const refused = (status: number, code: string, detail: string) =>
  ({
    error: { status, code, title: 'Refused', detail },
    response: new Response(null, { status }),
  }) as never;

function renderWith(app: App) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <SnapshotHooks app={app} />
      </ConfirmProvider>
    </QueryClientProvider>
  );
}

const group = (name: string) => screen.getByRole('group', { name });
const body = (patch: ReturnType<typeof spyApi>, call = 0) =>
  (patch.mock.calls[call][1] as { body: object }).body;

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.toast.mockReset();
  mocks.refresh.mockReset();
  mocks.access = 'on';
  mocks.maturity = 'beta';
});

describe('SnapshotHooks', () => {
  it('is labelled beta and shows each stored hook with what calls it', () => {
    renderWith(hooked);
    expect(screen.getByRole('heading', { name: 'Snapshot hooks' })).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();

    const after = group('After restore');
    expect(within(after).getByLabelText('Path')).toHaveValue('/internal/after-restore');
    expect(within(after).getByLabelText('Timeout (ms)')).toHaveValue(1500);
    expect(within(after).getByText('On')).toBeInTheDocument();
    expect(after).toHaveTextContent('X-Faas-After-Restore: 1');
    expect(after).toHaveTextContent(/not on a cold boot/i);

    const before = group('Before checkpoint');
    expect(within(before).getByLabelText('Path')).toHaveValue('');
    expect(within(before).getByLabelText('Timeout (ms)')).toHaveAttribute(
      'placeholder',
      '500 (default)'
    );
    expect(within(before).getByText('Off')).toBeInTheDocument();
    expect(before).toHaveTextContent('before_checkpoint_failed');
    expect(before).toHaveTextContent(/warm snapshots are not captured/i);
  });

  it('says that a gregale.yaml lifecycle block replaces what is saved here on every deploy', () => {
    renderWith(hooked);
    expect(
      screen.getByText(/a deploy whose gregale\.yaml declares one replaces the hook saved here/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText('gregale.yaml lifecycle hooks').textContent).toBe(
      'lifecycle:\n  after_restore:\n    path: /internal/after-restore\n    timeout_ms: 1500'
    );
  });

  it('saves only the hook that changed, and says it applies from the next deploy', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(accepted(hooked));
    const user = userEvent.setup();
    renderWith(bare);
    expect(screen.getByRole('button', { name: 'Save hooks' })).toBeDisabled();
    await user.type(
      within(group('After restore')).getByLabelText('Path'),
      '/internal/after-restore'
    );
    await user.type(within(group('After restore')).getByLabelText('Timeout (ms)'), '1500');
    await user.click(screen.getByRole('button', { name: 'Save hooks' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(patch.mock.calls[0][1]).toMatchObject({ params: { path: { slug: 'api-gateway' } } });
    expect(body(patch)).toEqual({
      after_restore: { path: '/internal/after-restore', timeout_ms: 1500 },
    });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast.mock.calls[0][0]).toMatchObject({ kind: 'success' });
    expect(mocks.toast.mock.calls[0][0].description).toMatch(/next deploy/i);
    expect(mocks.toast.mock.calls[0][0].description).not.toMatch(/snapshots/i);
  });

  it('warns that changing before_checkpoint discards the app’s snapshots', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(accepted(hooked));
    const user = userEvent.setup();
    renderWith(bare);
    await user.type(within(group('Before checkpoint')).getByLabelText('Path'), '/flush');
    await user.click(screen.getByRole('button', { name: 'Save hooks' }));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(body(patch)).toEqual({ before_checkpoint: { path: '/flush' } });
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast.mock.calls[0][0].description).toMatch(/snapshots were discarded/i);
  });

  it('asks before removing a hook, and sends the empty object apid reads as clear', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(accepted(bare));
    const user = userEvent.setup();
    renderWith(hooked);
    await user.click(within(group('After restore')).getByRole('button', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('/internal/after-restore');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(patch).not.toHaveBeenCalled();

    await user.click(within(group('After restore')).getByRole('button', { name: 'Remove' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove hook' })
    );
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(body(patch)).toEqual({ after_restore: {} });
  });

  it('treats an emptied path as a removal, which asks first too', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(accepted(bare));
    const user = userEvent.setup();
    renderWith(hooked);
    await user.clear(within(group('After restore')).getByLabelText('Path'));
    await user.clear(within(group('After restore')).getByLabelText('Timeout (ms)'));
    await user.click(screen.getByRole('button', { name: 'Save hooks' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove hook' })
    );
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(body(patch)).toEqual({ after_restore: {} });
  });

  it('refuses a path apid would refuse before it leaves the browser', async () => {
    const patch = spyApi('PATCH');
    const user = userEvent.setup();
    renderWith(bare);
    const path = within(group('After restore')).getByLabelText('Path');
    await user.type(path, 'internal?x=1');
    expect(path).toHaveAttribute('aria-invalid', 'true');
    expect(within(group('After restore')).getByText(/absolute path/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save hooks' })).toBeDisabled();
    expect(patch).not.toHaveBeenCalled();
  });

  it('shows apid’s reason and code when it refuses the change', async () => {
    spyApi('PATCH').mockResolvedValue(
      refused(
        400,
        'validation_failed',
        'app manifest: after_restore requires request or service execution mode'
      )
    );
    const user = userEvent.setup();
    renderWith(bare);
    await user.type(within(group('After restore')).getByLabelText('Path'), '/x');
    await user.click(screen.getByRole('button', { name: 'Save hooks' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/requires request or service/);
    expect(screen.getByText('validation_failed')).toBeInTheDocument();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('rereads availability when apid says the capability is not released', async () => {
    spyApi('PATCH').mockResolvedValue(
      refused(
        403,
        'capability_not_released',
        'app.after_restore needs the Snapshot lifecycle hooks capability, which is not available to this account; remove it or contact support for access.'
      )
    );
    const user = userEvent.setup();
    renderWith(bare);
    await user.type(within(group('After restore')).getByLabelText('Path'), '/x');
    await user.click(screen.getByRole('button', { name: 'Save hooks' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not available to this account/);
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('says a before_checkpoint hook stops warm snapshots when the app has them on', () => {
    renderWith({
      ...bare,
      warm_snapshot_enabled: true,
      manifest: { ...bare.manifest, before_checkpoint: { path: '/flush' } },
    } as unknown as App);
    expect(screen.getByRole('note')).toHaveTextContent(
      /warm snapshots are on for this app, but none is captured while before_checkpoint is set/i
    );
  });

  it('explains that workers and jobs are never snapshotted, and offers no fields', () => {
    renderWith({
      ...bare,
      manifest: { entrypoint: ['node', 'worker.js'], execution_mode: 'worker' },
    } as unknown as App);
    expect(screen.getByText(/this app runs in worker mode/i)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'After restore' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save hooks' })).not.toBeInTheDocument();
  });

  it('shows the off state, read-only, when the capability is not enabled for the account', () => {
    mocks.access = 'off';
    renderWith(hooked);
    expect(screen.getByRole('status')).toHaveTextContent('Not enabled for this account');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save hooks' })).not.toBeInTheDocument();
    // A hook set before still runs; it is shown, not hidden.
    expect(screen.getByText('/internal/after-restore')).toBeInTheDocument();
  });

  it('waits for the registry before offering anything to edit', () => {
    mocks.access = 'loading';
    mocks.maturity = undefined;
    renderWith(hooked);
    expect(screen.getByText('Checking availability…')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  });

  it('offers a retry when availability could not be checked', async () => {
    mocks.access = 'registry-error';
    const user = userEvent.setup();
    renderWith(bare);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.refresh).toHaveBeenCalled();
  });
});
