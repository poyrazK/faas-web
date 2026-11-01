import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { SecretsBody } from '@/components/dashboard/secrets-page';

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  del: vi.fn(),
  rotate: vi.fn(),
  restart: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/components/dashboard/env-import', () => ({
  EnvImportButton: ({ onChanged }: { onChanged?: () => void }) => (
    <button type="button" onClick={onChanged}>
      finish import
    </button>
  ),
}));
vi.mock('@/lib/api/queries', () => ({
  useAppSecrets: () => ({
    data: { secrets: [{ key: 'API_TOKEN', updated_at: '2026-10-01T00:00:00Z', kid: 'k1' }] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSetSecret: () => ({ mutateAsync: mocks.set, isPending: false }),
  useDeleteSecret: () => ({ mutateAsync: mocks.del, isPending: false }),
  useRotateSecret: () => ({ mutateAsync: mocks.rotate, isPending: false }),
  useFreshRestart: () => ({ mutateAsync: mocks.restart, isPending: false }),
}));

// Delete goes through #245's revocation hook; these tests cover the page, not the receipt.
vi.mock('@/lib/api/secret-references', () => ({
  useRevokeSecret: () => ({ mutateAsync: mocks.del, isPending: false }),
}));
vi.mock('@/components/dashboard/secret-references', () => ({ SecretReferences: () => null }));

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN\n-----END PRIVATE KEY-----';

beforeEach(() => {
  mocks.set.mockReset().mockResolvedValue({});
  mocks.del.mockReset().mockResolvedValue({});
  mocks.rotate.mockReset().mockResolvedValue({ key: 'API_TOKEN', kid: 'k2' });
  mocks.restart.mockReset().mockResolvedValue({ wake_id: 'w1' });
  mocks.confirm.mockReset();
  mocks.toast.mockReset();
});

async function save(user: ReturnType<typeof userEvent.setup>, key: string, paste: string) {
  await user.type(screen.getByPlaceholderText('DATABASE_URL'), key);
  await user.click(screen.getByLabelText('Value'));
  await user.paste(paste);
  await user.click(screen.getByRole('button', { name: 'Save secret' }));
}

describe('Secrets', () => {
  it('saves a multi-line secret with its line breaks', async () => {
    const user = userEvent.setup();
    render(<SecretsBody slug="alpha" />);
    await save(user, 'TLS_KEY', PEM);
    await waitFor(() => expect(mocks.set).toHaveBeenCalledWith({ key: 'TLS_KEY', value: PEM }));
  });

  it('masks the value field again after a multi-line secret is saved', async () => {
    const user = userEvent.setup();
    render(<SecretsBody slug="alpha" />);
    await save(user, 'TLS_KEY', PEM);
    await waitFor(() => expect(mocks.set).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByLabelText('Value').tagName).toBe('INPUT'));
    expect(screen.getByLabelText('Value')).toHaveAttribute('type', 'password');
  });

  it('keeps the multi-line value when the save fails', async () => {
    const user = userEvent.setup();
    mocks.set.mockRejectedValue(new Error('nope'));
    render(<SecretsBody slug="alpha" />);
    await save(user, 'TLS_KEY', PEM);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(screen.getByLabelText('Value').tagName).toBe('TEXTAREA');
    expect(screen.getByLabelText('Value')).toHaveValue(PEM);
  });

  it('masks the rotate field again when the dialog is closed and reopened', async () => {
    const user = userEvent.setup();
    render(<SecretsBody slug="alpha" />);
    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    await user.click(screen.getByLabelText('New value'));
    await user.paste(PEM);
    expect(screen.getByLabelText('New value').tagName).toBe('TEXTAREA');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Rotate' }));
    expect(await screen.findByLabelText('New value')).toHaveAttribute('type', 'password');
  });

  it('asks before replacing a secret that already exists', async () => {
    const user = userEvent.setup();
    mocks.confirm.mockResolvedValue(false);
    render(<SecretsBody slug="alpha" />);
    await save(user, 'API_TOKEN', 'new-value');
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringMatching(/API_TOKEN/) })
      )
    );
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('does not ask when the name is new', async () => {
    const user = userEvent.setup();
    render(<SecretsBody slug="alpha" />);
    await save(user, 'NEW_KEY', 'value');
    await waitFor(() => expect(mocks.set).toHaveBeenCalled());
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('says the new value applies on the next cold start or a restart when replacing', async () => {
    const user = userEvent.setup();
    mocks.confirm.mockResolvedValue(false);
    render(<SecretsBody slug="alpha" />);
    await save(user, 'API_TOKEN', 'new-value');
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringMatching(/next cold start,? or .*restart/i),
        })
      )
    );
  });

  describe('applying new values', () => {
    const NOTICE = { name: 'Apply the new values' };

    it('shows no notice before anything has been saved', () => {
      render(<SecretsBody slug="alpha" />);
      expect(screen.queryByRole('status', NOTICE)).toBeNull();
    });

    it('warns that running instances keep the previous values after a save', async () => {
      const user = userEvent.setup();
      render(<SecretsBody slug="alpha" />);
      await save(user, 'NEW_KEY', 'value');
      const notice = await screen.findByRole('status', NOTICE);
      expect(notice).toHaveTextContent(
        'Running instances keep the previous values until they restart.'
      );
      expect(
        within(notice).getByRole('button', { name: 'Restart with the new values' })
      ).toBeInTheDocument();
    });

    it('shows the same notice after a rotation', async () => {
      const user = userEvent.setup();
      render(<SecretsBody slug="alpha" />);
      await user.click(screen.getByRole('button', { name: 'Rotate' }));
      await user.click(screen.getByLabelText('New value'));
      await user.paste('rotated');
      await user.click(screen.getByRole('button', { name: 'Rotate secret' }));
      await waitFor(() => expect(mocks.rotate).toHaveBeenCalled());
      expect(await screen.findByRole('status', NOTICE)).toBeInTheDocument();
    });

    it('does not show the notice when the save failed', async () => {
      const user = userEvent.setup();
      mocks.set.mockRejectedValue(new Error('nope'));
      render(<SecretsBody slug="alpha" />);
      await save(user, 'NEW_KEY', 'value');
      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
      );
      expect(screen.queryByRole('status', NOTICE)).toBeNull();
    });

    it('shows the notice after a secret is deleted, since the next boot lacks it', async () => {
      const user = userEvent.setup();
      mocks.confirm.mockResolvedValue(true);
      render(<SecretsBody slug="alpha" />);
      await user.click(screen.getByRole('button', { name: 'Delete secret API_TOKEN' }));
      await waitFor(() => expect(mocks.del).toHaveBeenCalledWith('API_TOKEN'));
      expect(await screen.findByRole('status', NOTICE)).toBeInTheDocument();
    });

    it('shows the notice after a .env import writes values', async () => {
      const user = userEvent.setup();
      render(<SecretsBody slug="alpha" />);
      await user.click(screen.getByRole('button', { name: 'finish import' }));
      expect(await screen.findByRole('status', NOTICE)).toBeInTheDocument();
    });

    async function savedThenRestart(user: ReturnType<typeof userEvent.setup>) {
      render(<SecretsBody slug="alpha" />);
      await save(user, 'NEW_KEY', 'value');
      await user.click(await screen.findByRole('button', { name: 'Restart with the new values' }));
    }

    it('asks before restarting and does nothing when declined', async () => {
      const user = userEvent.setup();
      mocks.confirm.mockResolvedValue(false);
      await savedThenRestart(user);
      await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
      expect(mocks.restart).not.toHaveBeenCalled();
      expect(screen.getByRole('status', NOTICE)).toBeInTheDocument();
    });

    it('restarts fresh once confirmed, reports it queued, and clears the notice', async () => {
      const user = userEvent.setup();
      mocks.confirm.mockResolvedValue(true);
      await savedThenRestart(user);
      await waitFor(() => expect(mocks.restart).toHaveBeenCalledTimes(1));
      expect(mocks.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'success', title: 'Restart queued' })
      );
      await waitFor(() => expect(screen.queryByRole('status', NOTICE)).toBeNull());
    });

    it('shows the API message and keeps the notice when the restart is refused', async () => {
      const user = userEvent.setup();
      mocks.confirm.mockResolvedValue(true);
      mocks.restart.mockRejectedValue(
        new ApiError({
          status: 409,
          code: 'conflict',
          title: 'Restart already in progress',
          detail: 'wait for the accepted restart to finish before retrying',
        })
      );
      await savedThenRestart(user);
      await waitFor(() =>
        expect(mocks.toast).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'error',
            error: expect.objectContaining({
              message: 'wait for the accepted restart to finish before retrying',
            }),
          })
        )
      );
      expect(screen.getByRole('status', NOTICE)).toBeInTheDocument();
    });
  });
});
