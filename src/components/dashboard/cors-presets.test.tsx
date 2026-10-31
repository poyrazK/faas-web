import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useCorsPresets = vi.fn();
const useApp = vi.fn();
const create = vi.fn();
const remove = vi.fn();
const update = vi.fn();
const useEdgeRules = vi.fn();
const workspace = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useCorsPresets: (appId?: string) => useCorsPresets(appId) as unknown,
  useApp: (slug: string) => useApp(slug) as unknown,
  useApps: () => ({ data: [{ id: 'app1', slug: 'api' }] }),
  useEdgeRules: (enabled: boolean, accountId?: string) =>
    useEdgeRules(enabled, accountId) as unknown,
  useCreateCorsPreset: () => ({ mutateAsync: create, isPending: false }),
  useDeleteCorsPreset: () => ({ mutateAsync: remove, isPending: false }),
}));
vi.mock('@/lib/api/edge-protection', async (original) => ({
  ...(await original<typeof import('@/lib/api/edge-protection')>()),
  useUpdateCorsPreset: () => ({ mutateAsync: update, isPending: false }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({
  useWorkspaceTarget: () => workspace() as unknown,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct' } }) }));
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
  update
    .mockReset()
    .mockImplementation(({ body }: { body: object }) =>
      Promise.resolve(preset(body as Record<string, unknown>))
    );
  useEdgeRules.mockReset().mockReturnValue(
    ready([
      {
        id: 'r1',
        app_id: 'app1',
        kind: 'cors',
        match_host: 'api.acme.dev',
        match_path: '/*',
        action: { cors_preset_id: 'p1' },
      },
    ])
  );
  workspace.mockReset().mockReturnValue({ org: null, label: 'Personal', ready: true });
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

  it("shows apid's sentence for a refusal it marks validation_failed", async () => {
    // A duplicate name is 409 with code validation_failed (handlers_cors_presets.go:377),
    // so the detail is what tells the person what to change.
    create.mockRejectedValueOnce(
      new ApiError({
        status: 409,
        code: 'validation_failed',
        title: 'Name already in use',
        detail: 'a cors preset with this name already exists for the (account, app) tuple',
      })
    );
    render(<CorsPresetsPanel slug="api" />);
    await userEvent.type(screen.getByLabelText('Preset name'), 'web-clients');
    await userEvent.type(screen.getByLabelText('Allowed origins'), 'https://a.example');
    await userEvent.click(screen.getByRole('button', { name: /create preset/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    // The toast renders the problem itself (ProblemHelp), so apid's sentence shows.
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ message: expect.stringMatching(/already exists/) }),
      })
    );
  });

  it('reads plan_cors_presets_not_allowed as the plan', async () => {
    create.mockRejectedValueOnce(
      new ApiError({ status: 402, code: 'plan_cors_presets_not_allowed', title: 'Upgrade' })
    );
    render(<CorsPresetsPanel slug="api" />);
    await userEvent.type(screen.getByLabelText('Preset name'), 'x');
    await userEvent.type(screen.getByLabelText('Allowed origins'), 'https://a.example');
    await userEvent.click(screen.getByRole('button', { name: /create preset/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Not on your plan' }))
    );
  });

  it('confirms before deleting, naming the rules that use the preset', async () => {
    render(<CorsPresetsPanel slug="api" />);
    expect(screen.getByText('Used by 1 rule')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /delete preset web-clients/i }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }))
    );
    const asked = confirm.mock.calls[0][0] as { description: string };
    expect(asked.description).toMatch(/api · api\.acme\.dev\/\*/);
    expect(asked.description).toMatch(/This rule loses the link and fails closed/);
    expect(remove).toHaveBeenCalledWith('p1');
  });

  it('says no rule uses a preset nothing references', async () => {
    useEdgeRules.mockReturnValue(ready([]));
    render(<CorsPresetsPanel slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /delete preset web-clients/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect((confirm.mock.calls[0][0] as { description: string }).description).toMatch(
      /no edge rule uses it/i
    );
  });

  it('edits a preset, sending only what changed', async () => {
    render(<CorsPresetsPanel slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit preset web-clients' }));
    const form = screen.getByRole('form', { name: 'Edit preset web-clients' });
    const save = within(form).getByRole('button', { name: /save preset/i });
    expect(save).toBeDisabled();
    expect(within(form).getByText(/api · api\.acme\.dev\/\*/)).toBeInTheDocument();
    const maxAge = within(form).getByLabelText('Max age seconds');
    await userEvent.clear(maxAge);
    await userEvent.type(maxAge, '60');
    await userEvent.click(save);
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ id: 'p1', body: { max_age_seconds: 60 } })
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('sends a replaced origin list and refuses an emptied one', async () => {
    render(<CorsPresetsPanel slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit preset web-clients' }));
    const form = screen.getByRole('form', { name: 'Edit preset web-clients' });
    const origins = within(form).getByLabelText('Allowed origins');
    await userEvent.clear(origins);
    expect(within(form).getByRole('button', { name: /save preset/i })).toBeDisabled();
    await userEvent.type(origins, 'https://new.example');
    await userEvent.click(within(form).getByRole('button', { name: /save preset/i }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        id: 'p1',
        body: { allow_origins: ['https://new.example'] },
      })
    );
  });

  it('creates and edits the description and exposed headers too', async () => {
    render(<CorsPresetsPanel slug="api" />);
    await userEvent.type(screen.getByLabelText('Preset name'), 'docs');
    await userEvent.type(screen.getByLabelText('Preset description'), 'The docs site');
    await userEvent.type(screen.getByLabelText('Allowed origins'), 'https://docs.example');
    await userEvent.type(screen.getByLabelText('Exposed headers'), 'X-Request-Id');
    await userEvent.click(screen.getByRole('button', { name: /create preset/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ description: 'The docs site', expose_headers: ['X-Request-Id'] })
      )
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit preset web-clients' }));
    const form = screen.getByRole('form', { name: 'Edit preset web-clients' });
    await userEvent.type(within(form).getByLabelText('Exposed headers'), 'ETag');
    await userEvent.click(within(form).getByRole('button', { name: /save preset/i }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ id: 'p1', body: { expose_headers: ['ETag'] } })
    );
  });

  it('keeps the edit open and says why when apid refuses it', async () => {
    update.mockRejectedValueOnce(
      new ApiError({
        status: 422,
        code: 'cors_preset_too_large',
        title: 'Too large',
        detail: 'allow_origins lists 30; your plan allows 20',
      })
    );
    render(<CorsPresetsPanel slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit preset web-clients' }));
    const form = screen.getByRole('form', { name: 'Edit preset web-clients' });
    await userEvent.clear(within(form).getByLabelText('Max age seconds'));
    await userEvent.type(within(form).getByLabelText('Max age seconds'), '5');
    await userEvent.click(within(form).getByRole('button', { name: /save preset/i }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Too many entries for your plan' })
      )
    );
    expect(screen.getByRole('form', { name: 'Edit preset web-clients' })).toBeInTheDocument();
  });

  it("never shows the personal account's presets in a company workspace", () => {
    workspace.mockReturnValue({ org: 'acme', label: 'Acme Inc', ready: true });
    render(<CorsPresetsPanel slug="api" />);
    expect(useCorsPresets).not.toHaveBeenCalled();
    expect(screen.queryByText('web-clients')).not.toBeInTheDocument();
    expect(screen.getByText(/Acme Inc has no CORS presets of its own/)).toBeInTheDocument();
  });

  it('reads nothing until the workspace is known', () => {
    workspace.mockReturnValue({ org: null, label: 'Personal', ready: false });
    render(<CorsPresetsPanel slug="api" />);
    expect(useCorsPresets).not.toHaveBeenCalled();
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

  it('offers no personal presets in a company workspace', () => {
    workspace.mockReturnValue({ org: 'acme', label: 'Acme Inc', ready: true });
    const { container } = render(<CorsPresetPicker value={null} onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(useCorsPresets).not.toHaveBeenCalled();
  });

  it('renders nothing when there are no presets to offer', () => {
    useCorsPresets.mockReturnValue(ready({ presets: [] }));
    const { container } = render(<CorsPresetPicker value={null} onPick={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
