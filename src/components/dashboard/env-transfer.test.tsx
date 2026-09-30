import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvTransferPanel } from './env-transfer';
import { api } from '@/lib/api/client';
import { applyEnvImport, fetchEnvExport } from '@/lib/api/env-transfer';
const mocks = vi.hoisted(() => ({ confirm: vi.fn(), accountId: 'account-1' }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: mocks.accountId } }) }));
vi.mock('@/lib/api/env-transfer', () => ({ applyEnvImport: vi.fn(), fetchEnvExport: vi.fn() }));
const metadata = {
  env: [{ key: 'A', scope: 'default', updated_at: '2026-09-28', created_at: '2026-09-28' }],
  count: 1,
  quota_max: 16,
};
function mount(slug = 'alpha') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <EnvTransferPanel slug={slug} />
    </QueryClientProvider>
  );
  return {
    client,
    ...view,
    change: (next: string) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <EnvTransferPanel slug={next} />
        </QueryClientProvider>
      ),
  };
}
async function review() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Review import' })).not.toBeDisabled()
  );
}
async function pasteAndReview(text: string) {
  fireEvent.change(screen.getByLabelText('Paste .env contents'), { target: { value: text } });
  await review();
  await userEvent.click(screen.getByRole('button', { name: 'Review import' }));
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(applyEnvImport).mockReset();
  vi.mocked(fetchEnvExport).mockReset();
  mocks.accountId = 'account-1';
  mocks.confirm.mockReset().mockResolvedValue(true);
  vi.spyOn(api, 'GET').mockResolvedValue({ data: metadata, response: new Response() } as never);
  vi.mocked(applyEnvImport).mockResolvedValue({ saved: ['A'], failed: [] });
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = vi.fn(() => 'blob:test');
      static revokeObjectURL = vi.fn();
    }
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('environment transfer review', () => {
  it('shows additions, overwrites and redacted diagnostics before one confirmation', async () => {
    const { client } = mount();
    await pasteAndReview(
      'A=private-one\nB=private-two\nD=duplicate-one\nD=duplicate-two\nbad=private-invalid'
    );
    const preview = screen.getByRole('region', { name: 'Import dry run' });
    expect(preview).toHaveTextContent('1 additions · 1 overwrites · 3 issues');
    expect(preview).toHaveTextContent('A — Overwrite');
    expect(preview).toHaveTextContent('B — Add');
    expect(preview).not.toHaveTextContent('private-');
    expect(preview).not.toHaveTextContent('duplicate-one');
    expect(applyEnvImport).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Apply valid updates' }));
    await waitFor(() => expect(applyEnvImport).toHaveBeenCalledOnce());
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(applyEnvImport).toHaveBeenCalledWith(
      'alpha',
      'default',
      [
        { key: 'A', value: 'private-one' },
        { key: 'B', value: 'private-two' },
      ],
      expect.any(AbortSignal)
    );
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data)
      )
    ).not.toContain('private-');
    expect(screen.getByLabelText('Paste .env contents')).toHaveValue('');
  });
  it('locks duplicate submissions while confirmation is open and cancels without writes', async () => {
    let settle!: (value: boolean) => void;
    mocks.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve;
        })
    );
    mount();
    await pasteAndReview('A=changed');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Apply valid updates' }));
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(applyEnvImport).not.toHaveBeenCalled();
    await act(async () => {
      settle(false);
    });
    expect(applyEnvImport).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Paste .env contents')).toHaveValue('A=changed');
  });
  it('retains only failed entries for another review and confirmation', async () => {
    vi.mocked(applyEnvImport)
      .mockResolvedValueOnce({ saved: ['A'], failed: [{ key: 'B', message: 'Quota changed' }] })
      .mockResolvedValueOnce({ saved: ['B'], failed: [] });
    mount();
    await pasteAndReview('A=one\nB=two');
    await userEvent.click(screen.getByRole('button', { name: 'Apply valid updates' }));
    await waitFor(() => expect(screen.getByText('1 saved · 1 failed.')).toBeInTheDocument());
    expect(screen.getByLabelText('Paste .env contents')).toHaveValue('B="two"\n');
    await userEvent.click(screen.getByRole('button', { name: 'Review import' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply valid updates' }));
    await waitFor(() => expect(applyEnvImport).toHaveBeenCalledTimes(2));
    expect(applyEnvImport).toHaveBeenLastCalledWith(
      'alpha',
      'default',
      [{ key: 'B', value: 'two' }],
      expect.any(AbortSignal)
    );
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
  });
  it('uses the selected scope and blocks invalid/all-scope input or quota overflow', async () => {
    vi.mocked(api.GET).mockResolvedValue({
      data: { ...metadata, quota_max: 1 },
      response: new Response(),
    } as never);
    mount();
    await pasteAndReview('A=overwrite\nB=add');
    expect(screen.getByRole('button', { name: 'Apply valid updates' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('exceed the app quota');
    fireEvent.change(screen.getByLabelText('Transfer scope'), { target: { value: '__all__' } });
    expect(screen.getByRole('button', { name: 'Export .env' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Transfer scope'), { target: { value: 'staging' } });
    await waitFor(() =>
      expect(api.GET).toHaveBeenCalledWith(
        '/v1/apps/{slug}/env',
        expect.objectContaining({
          params: { path: { slug: 'alpha' }, query: { scope: 'staging' } },
        })
      )
    );
  });
  it('reads a selected file before review without dispatching writes', async () => {
    mount();
    const file = new File(['A=file-value'], 'vars.env', { type: 'text/plain' });
    Object.defineProperty(file, 'text', { value: async () => 'A=file-value' });
    await userEvent.upload(screen.getByLabelText('Choose a .env file (up to 1 MiB)'), file);
    await waitFor(() =>
      expect(screen.getByLabelText('Paste .env contents')).toHaveValue('A=file-value')
    );
    expect(applyEnvImport).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Review import' }));
    expect(screen.getByRole('region', { name: 'Import dry run' })).toHaveTextContent(
      'A — Overwrite'
    );
  });
  it('requires a sensitive-values confirmation before an explicit download and releases its blob', async () => {
    vi.mocked(fetchEnvExport).mockResolvedValue('A="private-export"\n');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { client } = mount();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export .env' })).not.toBeDisabled()
    );
    expect(fetchEnvExport).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Export .env' }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining('may be sensitive'),
        confirmLabel: 'Download .env',
      })
    );
    expect(fetchEnvExport).toHaveBeenCalledWith('alpha', 'default', expect.any(AbortSignal));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
    expect(
      JSON.stringify(
        client
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data)
      )
    ).not.toContain('private-export');
  });
  it('does not download after cancellation or a denied export', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    mocks.confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    vi.mocked(fetchEnvExport).mockRejectedValue(new Error('Export denied'));
    mount();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export .env' })).not.toBeDisabled()
    );
    await userEvent.click(screen.getByRole('button', { name: 'Export .env' }));
    expect(fetchEnvExport).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Export .env' }));
    expect(await screen.findByText('Export denied')).toBeInTheDocument();
    expect(click).not.toHaveBeenCalled();
  });
  it('discards staged values when the app or account changes', async () => {
    const view = mount();
    await pasteAndReview('A=private-staged');
    view.change('beta');
    expect(screen.getByLabelText('Paste .env contents')).toHaveValue('');
    await pasteAndReview('A=another-private');
    mocks.accountId = 'account-2';
    view.change('beta');
    expect(screen.getByLabelText('Paste .env contents')).toHaveValue('');
    expect(applyEnvImport).not.toHaveBeenCalled();
  });
  it('keeps writes disabled when existing metadata is denied', async () => {
    vi.mocked(api.GET).mockResolvedValue({
      error: { status: 403, code: 'forbidden', title: 'Names denied' },
      response: new Response(null, { status: 403 }),
    } as never);
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Names denied');
    fireEvent.change(screen.getByLabelText('Paste .env contents'), {
      target: { value: 'A=value' },
    });
    expect(screen.getByRole('button', { name: 'Review import' })).toBeDisabled();
    expect(applyEnvImport).not.toHaveBeenCalled();
  });
});
