import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1', plan: 'pro' } }) }));

const { SecretReferences } = await import('./secret-references');

const REFS = 'GET /v1/apps/{slug}/secret-references';
const PUT = 'PUT /v1/apps/{slug}/secret-references/{key}';
const DELETE = 'DELETE /v1/apps/{slug}/secret-references/{key}';
const SOURCES: Record<string, string[]> = {
  production: ['DATABASE_PRIMARY', 'STRIPE_LIVE_KEY'],
  staging: [],
};

let putAnswer: (() => Answer) | undefined;
let spies: ReturnType<typeof routeApi>;

type Init = { params?: { path?: Record<string, string>; query?: Record<string, unknown> } };
const env = (init: Init) => String(init.params?.query?.environment ?? '');

beforeEach(() => {
  putAnswer = undefined;
  spies = routeApi({
    'GET /v1/projects': () => [{ slug: 'shop', workload_count: 1 }],
    'GET /v1/projects/{slug}': () => ({ slug: 'shop', workloads: [{ slug: 'api' }] }),
    'GET /v1/projects/{slug}/environments': () => [
      { id: 'env-p', slug: 'production', protected: true },
      { id: 'env-s', slug: 'staging', protected: false },
    ],
    [REFS]: (init) =>
      env(init) === 'production'
        ? {
            environment_id: 'env-p',
            environment: 'production',
            references: { DATABASE_URL: 'secret:DATABASE_PRIMARY' },
            suppressed_keys: ['LEGACY_TOKEN'],
            count: 5,
            quota: 128,
          }
        : { environment_id: 'env-s', environment: env(init), references: {}, count: 5, quota: 128 },
    'GET /v1/apps/{slug}/secrets': (init) => ({
      secrets: (SOURCES[String(init.params?.query?.scope)] ?? []).map((key) => ({ key })),
      quota_max: 64,
      count: 0,
    }),
    [PUT]: () => (putAnswer ? putAnswer() : {}),
    [DELETE]: () => undefined,
  });
});

afterEach(() => vi.restoreAllMocks());

it('lists production references, removed keys and the shared quota', async () => {
  renderWithProviders(<SecretReferences slug="api" />);
  const row = (await screen.findByText('DATABASE_URL')).closest('li')!;
  expect(within(row).getByText('DATABASE_PRIMARY')).toBeInTheDocument();
  expect(screen.getByText('LEGACY_TOKEN')).toBeInTheDocument();
  expect(screen.getByText(/5 of 128 variables and references/i)).toBeInTheDocument();
  expect(screen.getByText(/next cold wake/i)).toBeInTheDocument();
  expect(spies.GET).toHaveBeenCalledWith(
    '/v1/apps/{slug}/secret-references',
    expect.objectContaining({
      params: { path: { slug: 'api' }, query: { environment: 'production' } },
    })
  );
});

it('switches environments, and says how to add a source when the environment has none', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SecretReferences slug="api" />);
  await user.selectOptions(await screen.findByLabelText('Environment'), 'staging');
  expect(await screen.findByText(/no references in staging/i)).toBeInTheDocument();
  expect(screen.getByText(/gregale env set --app api --env staging/)).toBeInTheDocument();
});

it('explains that an app outside every project has no references, and asks nothing', async () => {
  routeApi({
    'GET /v1/projects': () => [{ slug: 'shop', workload_count: 1 }],
    'GET /v1/projects/{slug}': () => ({ slug: 'shop', workloads: [{ slug: 'other' }] }),
  });
  renderWithProviders(<SecretReferences slug="api" />);
  expect(await screen.findByText(/api is not in a project/i)).toBeInTheDocument();
});

async function fillForm(destination: string, source = 'STRIPE_LIVE_KEY') {
  const user = userEvent.setup();
  renderWithProviders(<SecretReferences slug="api" />);
  await screen.findByText('DATABASE_URL');
  await user.type(screen.getByLabelText('Variable'), destination);
  await user.selectOptions(screen.getByLabelText('Source secret'), source);
  await user.click(screen.getByRole('button', { name: /save reference/i }));
  return user;
}

it('points a variable at a secret of the same environment', async () => {
  await fillForm('PAYMENTS_KEY');
  await waitFor(() =>
    expect(spies.PUT).toHaveBeenCalledWith('/v1/apps/{slug}/secret-references/{key}', {
      params: { path: { slug: 'api', key: 'PAYMENTS_KEY' }, query: { environment: 'production' } },
      body: { reference: 'secret:STRIPE_LIVE_KEY' },
    })
  );
  expect(
    await screen.findByText(/PAYMENTS_KEY now comes from STRIPE_LIVE_KEY/i)
  ).toBeInTheDocument();
});

it('names the shadowing plain variable on a reference conflict', async () => {
  putAnswer = () => problem(409, 'secret_reference_conflict');
  await fillForm('REGION');
  expect(await screen.findByText(/plain variable named REGION/i)).toBeInTheDocument();
});

it('says a missing source must be set in that environment first', async () => {
  putAnswer = () => problem(400, 'secret_not_found');
  await fillForm('PAYMENTS_KEY');
  expect(
    await screen.findByText(/no secret named STRIPE_LIVE_KEY in production/i)
  ).toBeInTheDocument();
});

it('says Git owns the reference', async () => {
  putAnswer = () => problem(409, 'environment_field_git_managed');
  await fillForm('PAYMENTS_KEY');
  expect(await screen.findByText(/managed by Git/i)).toBeInTheDocument();
});

it('rejects a destination that is not UPPER_SNAKE_CASE before asking', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SecretReferences slug="api" />);
  await screen.findByText('DATABASE_URL');
  await user.type(screen.getByLabelText('Variable'), 'lower');
  await user.tab();
  expect(screen.getByText(/UPPER_SNAKE_CASE/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /save reference/i })).toBeDisabled();
});

it('confirms a removal by naming what stops receiving the key, then deletes it', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SecretReferences slug="api" />);
  await user.click(await screen.findByRole('button', { name: 'Remove reference DATABASE_URL' }));
  const dialog = await screen.findByRole('dialog');
  expect(
    within(dialog).getByText(/stop delivering DATABASE_URL in production/i)
  ).toBeInTheDocument();
  expect(within(dialog).getByText(/finds it unset/i)).toBeInTheDocument();
  expect(within(dialog).getByText(/DATABASE_PRIMARY itself is kept/i)).toBeInTheDocument();
  expect(spies.DELETE).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Remove reference' }));
  await waitFor(() =>
    expect(spies.DELETE).toHaveBeenCalledWith('/v1/apps/{slug}/secret-references/{key}', {
      params: { path: { slug: 'api', key: 'DATABASE_URL' }, query: { environment: 'production' } },
    })
  );
});

it('offers to deliver a removed key again by filling the form', async () => {
  const user = userEvent.setup();
  renderWithProviders(<SecretReferences slug="api" />);
  await user.click(await screen.findByRole('button', { name: 'Deliver LEGACY_TOKEN again' }));
  expect(screen.getByLabelText('Variable')).toHaveValue('LEGACY_TOKEN');
});
