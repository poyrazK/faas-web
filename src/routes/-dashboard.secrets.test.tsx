import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretsBody } from './dashboard.secrets';

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/components/dashboard/env-import', () => ({ EnvImportButton: () => null }));
vi.mock('@/lib/api/queries', () => ({
  useAppSecrets: () => ({
    data: { secrets: [{ key: 'API_TOKEN', updated_at: '2026-10-01T00:00:00Z', kid: 'k1' }] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSetSecret: () => ({ mutateAsync: mocks.set, isPending: false }),
  useDeleteSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRotateSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADAN\n-----END PRIVATE KEY-----';

beforeEach(() => {
  mocks.set.mockReset().mockResolvedValue({});
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
});
