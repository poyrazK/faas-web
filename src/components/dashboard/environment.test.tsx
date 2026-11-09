import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, routeApi } from '@/test/monetization';

// The Environment tab read in plain English: the opening answer, the one
// primary action per section, per-row actions behind ⋯, and status words
// built from the API's own fields.
vi.mock('@/components/dashboard/secret-references', () => ({ SecretReferences: () => null }));
vi.mock('@/components/dashboard/env-import', () => ({ EnvImportButton: () => null }));
vi.mock('@/components/dashboard/env-transfer', () => ({
  EnvTransferPanel: () => <p>transfer panel</p>,
}));
vi.mock('@/components/dashboard/app-insights', () => ({
  EnvDiffPanel: () => <p>scope comparison</p>,
}));

const { EnvBody, EnvironmentSummary } = await import('@/components/dashboard/pages/env');
const { SecretsBody } = await import('@/components/dashboard/pages/secrets');

const stamp = { created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-02T00:00:00Z' };
const env = {
  env: ['LOG_LEVEL', 'REGION'].map((key) => ({ key, scope: 'default', ...stamp })),
  count: 2,
  quota_max: 128,
};
const sealed = (key: string, delivery_status: string) => ({
  key,
  scope: 'default',
  secret_class: 'persistent',
  delivery_version: 2,
  delivery_status,
  ...stamp,
});

let secrets: unknown[];
let spies: ReturnType<typeof routeApi>;
beforeEach(() => {
  secrets = [sealed('DATABASE_URL', 'pending'), sealed('API_TOKEN', 'delivered')];
  spies = routeApi({
    'GET /v1/apps/{slug}/env': () => env,
    'GET /v1/apps/{slug}/secrets': () => ({ secrets, count: secrets.length, quota_max: 64 }),
    'DELETE /v1/apps/{slug}/env/{key}': () => undefined,
  });
});
afterEach(() => vi.restoreAllMocks());

async function openMenu(key: string, action: string) {
  await userEvent.click(await screen.findByRole('button', { name: `Actions for ${key}` }));
  await userEvent.click(
    within(await screen.findByRole('menu')).getByRole('menuitem', { name: action })
  );
}

describe('Environment summary', () => {
  it('opens with the counts and the secret the app has not started with', async () => {
    renderWithProviders(<EnvironmentSummary slug="api" />);
    const summary = await screen.findByRole('region', { name: 'Environment summary' });
    await waitFor(() => expect(summary).toHaveTextContent('api has 2 variables and 2 secrets.'));
    expect(summary).toHaveTextContent('Applies on next start');
    expect(summary).toHaveTextContent(/new value of DATABASE_URL/);
  });

  it('says the app is up to date only when every secret is delivered', async () => {
    secrets = [sealed('API_TOKEN', 'delivered')];
    renderWithProviders(<EnvironmentSummary slug="api" />);
    const summary = await screen.findByRole('region', { name: 'Environment summary' });
    await waitFor(() => expect(summary).toHaveTextContent('Up to date'));
  });
});

describe('Variables', () => {
  it('leads with slots used and keeps the add form closed until asked', async () => {
    renderWithProviders(<EnvBody slug="api" />);
    expect(await screen.findByText(/2 of 128 slots used/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    expect(await screen.findByRole('dialog', { name: 'Add variable' })).toBeInTheDocument();
  });

  it('changes a variable from its ⋯ menu with the name filled in', async () => {
    renderWithProviders(<EnvBody slug="api" />);
    await openMenu('LOG_LEVEL', 'Change value');
    const sheet = await screen.findByRole('dialog', { name: 'Change LOG_LEVEL' });
    expect(within(sheet).getByPlaceholderText('LOG_LEVEL')).toHaveValue('LOG_LEVEL');
  });

  it('asks before deleting from the ⋯ menu', async () => {
    renderWithProviders(<EnvBody slug="api" />);
    await openMenu('REGION', 'Delete variable');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/starts without it/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete variable' }));
    await waitFor(() =>
      expect(spies.DELETE).toHaveBeenCalledWith(
        '/v1/apps/{slug}/env/{key}',
        expect.objectContaining({ params: { path: { slug: 'api', key: 'REGION' } } })
      )
    );
  });

  it('keeps the scope comparison and the import one click away', async () => {
    renderWithProviders(<EnvBody slug="api" />);
    expect(screen.queryByText('scope comparison')).toBeNull();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Compare with other environments' })
    );
    expect(screen.getByText('scope comparison')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import .env' }));
    expect(await screen.findByText('transfer panel')).toBeInTheDocument();
  });
});

describe('Secrets', () => {
  it('shows each secret’s delivery as a word, never its value', async () => {
    renderWithProviders(<SecretsBody slug="api" />);
    expect(await screen.findByText('Applies on next start')).toBeInTheDocument();
    expect(screen.getByText('In use')).toBeInTheDocument();
    expect(screen.queryByText(/sealed\)/)).toBeNull();
  });

  it('offers the restart when the API reports a value the app has not started with', async () => {
    renderWithProviders(<SecretsBody slug="api" />);
    const notice = await screen.findByRole('status', { name: 'Apply the new values' });
    expect(notice).toHaveTextContent(/One secret has a new value the app hasn’t started with yet/);
    expect(
      within(notice).getByRole('button', { name: 'Restart with the new values' })
    ).toBeEnabled();
  });

  it('shows no restart notice when every secret is in use', async () => {
    secrets = [sealed('API_TOKEN', 'delivered')];
    renderWithProviders(<SecretsBody slug="api" />);
    await screen.findByText('In use');
    expect(screen.queryByRole('status', { name: 'Apply the new values' })).toBeNull();
  });
});
