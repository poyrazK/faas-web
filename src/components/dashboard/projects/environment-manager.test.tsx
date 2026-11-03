import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { ProjectEnvironment } from '@/lib/api/projects';

const create = vi.fn();
const protect = vi.fn();
const remove = vi.fn();
const config = vi.fn();
const saveConfig = vi.fn();
const secrets = vi.fn();
const writeSecret = vi.fn();
const deleteSecret = vi.fn();
const confirm = vi.fn();
const toast = vi.fn();

vi.mock('@/lib/api/environments', () => ({
  useCreateEnvironment: () => ({ mutateAsync: create, isPending: false }),
  useProtectEnvironment: () => ({ mutateAsync: protect, isPending: false }),
  useDeleteEnvironment: () => ({ mutateAsync: remove, isPending: false }),
  useEnvironmentConfig: (...args: unknown[]) => config(...args) as unknown,
  useUpdateEnvironmentConfig: () => ({ mutateAsync: saveConfig, isPending: false }),
  useEnvironmentSecrets: (...args: unknown[]) => secrets(...args) as unknown,
  useWriteEnvironmentSecret: () => ({ mutateAsync: writeSecret, isPending: false }),
  useDeleteEnvironmentSecret: () => ({ mutateAsync: deleteSecret, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));

const { EnvironmentManager, EnvironmentConfigEditor, EnvironmentSecrets } =
  await import('./environment-manager');

const env = (slug: string, isProtected = false): ProjectEnvironment => ({
  id: `id-${slug}`,
  project_id: 'p',
  slug,
  protected: isProtected,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});
const items = [env('production', true), env('staging'), env('qa', true)];
const personal = { accountId: 'a', slug: 'shop', org: null };
const company = { accountId: 'a', slug: 'shop', org: 'acme' };
const read = <T,>(data: T, extra: Record<string, unknown> = {}) => ({
  data,
  error: null,
  isPending: false,
  refetch: vi.fn(),
  ...extra,
});

beforeEach(() => {
  for (const fn of [
    create,
    protect,
    remove,
    config,
    saveConfig,
    secrets,
    writeSecret,
    deleteSecret,
    confirm,
    toast,
  ])
    fn.mockReset();
  confirm.mockResolvedValue(true);
  config.mockReturnValue(
    read({
      project_slug: 'shop',
      environment: 'staging',
      version: 4,
      config_hash: 'c'.repeat(64),
      values: { LOG_LEVEL: 'info' },
      updated_at: '2026-10-30T00:00:00Z',
    })
  );
  secrets.mockReturnValue(
    read({
      project_slug: 'shop',
      environment: 'staging',
      limit: 50,
      secrets: [
        {
          key: 'DATABASE_PASSWORD',
          version: 3,
          kid: 'k1',
          value_hash: 'f'.repeat(64),
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-20T00:00:00Z',
        },
      ],
    })
  );
});

describe('EnvironmentManager', () => {
  it('shows protection in words and offers delete only where the API allows it', () => {
    render(
      <EnvironmentManager scope={personal} items={items} label="Personal" onCreated={vi.fn()} />
    );
    expect(screen.getAllByText('Protected')).toHaveLength(2);
    expect(screen.getByText('Unprotected')).toBeInTheDocument();
    expect(screen.getByText('Production cannot be deleted')).toBeInTheDocument();
    expect(screen.getByText('Unprotect to delete')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^delete /i })).toHaveLength(1);
  });

  it('creates a copy of another environment, sharing its resources when asked', async () => {
    const onCreated = vi.fn();
    create.mockResolvedValue(env('preview'));
    render(
      <EnvironmentManager scope={personal} items={items} label="Personal" onCreated={onCreated} />
    );
    await userEvent.type(screen.getByRole('textbox', { name: /new environment/i }), 'preview');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /copy from/i }), 'staging');
    await userEvent.click(screen.getByRole('checkbox', { name: /share staging/i }));
    await userEvent.click(screen.getByRole('button', { name: /create environment/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        body: {
          slug: 'preview',
          protected: false,
          from_environment: 'staging',
          share_resources: true,
        },
      })
    );
    expect(onCreated).toHaveBeenCalledWith('preview');
  });

  it('refuses a taken or reserved name before sending', async () => {
    render(
      <EnvironmentManager scope={personal} items={items} label="Personal" onCreated={vi.fn()} />
    );
    const name = screen.getByRole('textbox', { name: /new environment/i });
    await userEvent.type(name, 'staging');
    expect(screen.getByRole('button', { name: /create environment/i })).toBeDisabled();
    await userEvent.clear(name);
    await userEvent.type(name, 'default');
    expect(screen.getByRole('button', { name: /create environment/i })).toBeDisabled();
  });

  it('creates an empty company environment, with no copy offered', async () => {
    create.mockResolvedValue(env('preview'));
    render(<EnvironmentManager scope={company} items={items} label="Acme" onCreated={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: /copy from/i })).toBeNull();
    expect(screen.getByText(/New Acme environments start empty/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: /new environment/i }), 'preview');
    await userEvent.click(screen.getByRole('checkbox', { name: /protected/i }));
    await userEvent.click(screen.getByRole('button', { name: /create environment/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ body: { slug: 'preview', protected: true } })
    );
  });

  it('confirms removing protection as destructive, saying promotions stop needing approval', async () => {
    protect.mockResolvedValue(env('qa'));
    render(
      <EnvironmentManager scope={personal} items={items} label="Personal" onCreated={vi.fn()} />
    );
    const qa = screen.getByText('qa', { selector: 'span' }).closest('li')!;
    await userEvent.click(within(qa).getByRole('button', { name: 'Unprotect' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/no longer need an approval/),
      })
    );
    await waitFor(() =>
      expect(protect).toHaveBeenCalledWith({ environment: 'qa', protect: false })
    );
  });

  it('explains a company role refusal by its code', async () => {
    protect.mockRejectedValue(
      new ApiError({ status: 403, code: 'org_role_forbidden', title: 'No' })
    );
    render(<EnvironmentManager scope={company} items={items} label="Acme" onCreated={vi.fn()} />);
    const staging = screen.getByText('staging').closest('li')!;
    await userEvent.click(within(staging).getByRole('button', { name: 'Protect' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'Your role cannot do this' })
      )
    );
  });

  it('deletes behind a typed confirmation and reports queued cleanup', async () => {
    remove.mockResolvedValue({ cleanupPending: true });
    render(
      <EnvironmentManager scope={personal} items={items} label="Personal" onCreated={vi.fn()} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete staging' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, typeToConfirm: 'staging' })
    );
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ environment: 'staging' }));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/in the background/) })
    );
  });

  it('explains a refused delete of an environment still serving', async () => {
    remove.mockRejectedValue(new ApiError({ status: 409, code: 'conflict', title: 'No' }));
    render(
      <EnvironmentManager scope={personal} items={items} label="Personal" onCreated={vi.fn()} />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete staging' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/no live release/) })
      )
    );
  });
});

describe('EnvironmentConfigEditor', () => {
  it('replaces the whole document after saying keys left out are removed', async () => {
    saveConfig.mockResolvedValue({});
    render(<EnvironmentConfigEditor scope={personal} environment="staging" />);
    const editor = screen.getByRole('textbox', { name: /configuration/i });
    await userEvent.clear(editor);
    await userEvent.click(editor);
    await userEvent.paste('{"WORKERS": 4}');
    await userEvent.click(screen.getByRole('button', { name: /save configuration/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/version 5; keys left out are removed/),
      })
    );
    await waitFor(() => expect(saveConfig).toHaveBeenCalledWith({ WORKERS: 4 }));
  });

  it('holds back a document that is not one JSON object', async () => {
    render(<EnvironmentConfigEditor scope={personal} environment="staging" />);
    const editor = screen.getByRole('textbox', { name: /configuration/i });
    await userEvent.clear(editor);
    await userEvent.click(editor);
    await userEvent.paste('[1, 2]');
    expect(screen.getByText('The configuration is one JSON object.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save configuration/i })).toBeDisabled();
  });

  it('keeps a failed read apart from an empty document', () => {
    config.mockReturnValue(
      read(undefined, { error: new ApiError({ status: 404, code: 'not_found', title: 'Gone' }) })
    );
    render(<EnvironmentConfigEditor scope={personal} environment="staging" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('EnvironmentSecrets', () => {
  it('lists metadata only, and points an existing key to rotation', async () => {
    render(<EnvironmentSecrets scope={personal} environment="staging" />);
    expect(screen.getByText('DATABASE_PASSWORD')).toBeInTheDocument();
    expect(screen.getByText(/1 of 50 shared secrets/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Key' }), 'database_password');
    expect(screen.getByText(/exists: rotate it above/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add secret' })).toBeDisabled();
  });

  it('adds a secret and clears the value it sent', async () => {
    writeSecret.mockResolvedValue({});
    const { container } = render(<EnvironmentSecrets scope={personal} environment="staging" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Key' }), 'PAYMENTS_KEY');
    const value = container.querySelector<HTMLInputElement>('input[type="password"]')!;
    await userEvent.type(value, 's3cret');
    await userEvent.click(screen.getByRole('button', { name: 'Add secret' }));
    await waitFor(() =>
      expect(writeSecret).toHaveBeenCalledWith({
        key: 'PAYMENTS_KEY',
        value: 's3cret',
        rotate: false,
      })
    );
    expect(value.value).toBe('');
  });

  it('rotates after saying when services see the new value', async () => {
    writeSecret.mockResolvedValue({});
    const { container } = render(<EnvironmentSecrets scope={personal} environment="staging" />);
    await userEvent.click(screen.getByRole('button', { name: 'Rotate' }));
    const inputs = container.querySelectorAll<HTMLInputElement>('input[type="password"]');
    await userEvent.type(inputs[0], 'next');
    await userEvent.click(screen.getByRole('button', { name: 'Replace value' }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ description: expect.stringMatching(/at its next boot/) })
    );
    await waitFor(() =>
      expect(writeSecret).toHaveBeenCalledWith({
        key: 'DATABASE_PASSWORD',
        value: 'next',
        rotate: true,
      })
    );
  });

  it('deletes behind a destructive confirmation', async () => {
    deleteSecret.mockResolvedValue(undefined);
    render(<EnvironmentSecrets scope={personal} environment="staging" />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete DATABASE_PASSWORD' }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    await waitFor(() => expect(deleteSecret).toHaveBeenCalledWith('DATABASE_PASSWORD'));
  });

  it('explains the plan limit by its code', async () => {
    writeSecret.mockRejectedValue(
      new ApiError({ status: 403, code: 'plan_limit_project_secrets', title: 'Limit' })
    );
    const { container } = render(<EnvironmentSecrets scope={personal} environment="staging" />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Key' }), 'NEW_KEY');
    await userEvent.type(container.querySelector('input[type="password"]')!, 'v');
    await userEvent.click(screen.getByRole('button', { name: 'Add secret' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'info', title: 'Shared secret limit reached' })
      )
    );
  });
});
