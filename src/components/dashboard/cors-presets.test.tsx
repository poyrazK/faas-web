import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useCorsPresets = vi.fn();
const useApp = vi.fn();
const create = vi.fn();
const remove = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useCorsPresets: (appId?: string) => useCorsPresets(appId) as unknown,
  useApp: (slug: string) => useApp(slug) as unknown,
  useCreateCorsPreset: () => ({ mutateAsync: create, isPending: false }),
  useDeleteCorsPreset: () => ({ mutateAsync: remove, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { CorsPresetPicker, CorsPresetsPanel } = await import('./cors-presets');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const preset = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  account_id: 'acct',
  app_id: null,
  name: 'web-clients',
  allow_origins: ['https://acme.example'],
  allow_methods: ['GET', 'POST'],
  allow_headers: ['Authorization'],
  expose_headers: [],
  allow_credentials: true,
  max_age_seconds: 600,
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  useCorsPresets
    .mockReset()
    .mockReturnValue(
      ready({ presets: [preset(), preset({ id: 'p2', name: 'other-app', app_id: 'app2' })] })
    );
  useApp.mockReset().mockReturnValue(ready({ id: 'app1', slug: 'api' }));
  create.mockReset().mockResolvedValue(preset({ id: 'p3', name: 'new' }));
  remove.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('CorsPresetsPanel', () => {
  it('shows account-wide presets and hides ones scoped to other apps', () => {
    render(<CorsPresetsPanel slug="api" />);
    expect(screen.getByText('web-clients')).toBeInTheDocument();
    expect(screen.queryByText('other-app')).not.toBeInTheDocument();
  });

  it('refuses a wildcard origin with credentials before sending it', async () => {
    render(<CorsPresetsPanel slug="api" />);
    await userEvent.type(screen.getByLabelText('Preset name'), 'open');
    await userEvent.type(screen.getByLabelText('Allowed origins'), '*');
    await userEvent.click(screen.getByRole('switch', { name: /allow credentials/i }));
    expect(screen.getByText(/browsers refuse credentials for a wildcard/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create preset/i })).toBeDisabled();
  });

  it('creates a preset scoped to the app with the parsed lists', async () => {
    render(<CorsPresetsPanel slug="api" />);
    await userEvent.type(screen.getByLabelText('Preset name'), 'admin');
    await userEvent.type(
      screen.getByLabelText('Allowed origins'),
      'https://a.example https://b.example'
    );
    await userEvent.click(screen.getByRole('button', { name: 'POST' }));
    await userEvent.click(screen.getByRole('button', { name: /create preset/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'admin',
          app_id: 'app1',
          allow_origins: ['https://a.example', 'https://b.example'],
          allow_methods: ['GET', 'POST'],
          allow_credentials: false,
          max_age_seconds: 600,
        })
      )
    );
  });

  it('reads a 409 as a name conflict and a 402 as the plan', async () => {
    create.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'cors_preset_name_conflict', title: 'Conflict' })
    );
    render(<CorsPresetsPanel slug="api" />);
    await userEvent.type(screen.getByLabelText('Preset name'), 'web-clients');
    await userEvent.type(screen.getByLabelText('Allowed origins'), 'https://a.example');
    await userEvent.click(screen.getByRole('button', { name: /create preset/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'A preset with that name exists' })
    );
  });

  it('confirms before deleting, since rules that reference the preset fail closed', async () => {
    render(<CorsPresetsPanel slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /delete preset web-clients/i }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }))
    );
    expect(remove).toHaveBeenCalledWith('p1');
  });
});

describe('CorsPresetPicker', () => {
  it('hands the chosen preset to the rule form and null when cleared', async () => {
    const onPick = vi.fn();
    render(<CorsPresetPicker value={null} onPick={onPick} />);
    await userEvent.selectOptions(screen.getByLabelText('CORS preset'), 'p1');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    await userEvent.selectOptions(screen.getByLabelText('CORS preset'), '');
    expect(onPick).toHaveBeenLastCalledWith(null);
  });

  it('renders nothing when there are no presets to offer', () => {
    useCorsPresets.mockReturnValue(ready({ presets: [] }));
    const { container } = render(<CorsPresetPicker value={null} onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
