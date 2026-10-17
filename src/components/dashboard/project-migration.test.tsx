import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectMigration } from './project-migration';
const mocks = vi.hoisted(() => ({ scan: vi.fn(), create: vi.fn(), pointer: vi.fn() }));
vi.mock('@/lib/api/project-migration', () => ({
  scanMigrationProject: mocks.scan,
  createProjectMigration: mocks.create,
}));
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: vi.fn() }));
vi.mock('./repo-picker', () => ({
  RepoPicker: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="Repository" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock('./project-migration-progress', () => ({
  ProjectMigrationProgress: ({ id, submissionError }: { id: string; submissionError: string }) => (
    <div role="status">
      Saved migration {id} {submissionError}
    </div>
  ),
}));
const api = {
  name: 'api',
  app_slug: 'shop-api',
  public_url: 'https://shop-api.gregale.dev',
  root_dir: 'api',
  class: 'http',
  command: ['node', 'server.js'],
  required_env_keys: ['DATABASE_URL'],
  depends_on: [],
};
const web = {
  name: 'web',
  app_slug: 'shop-web',
  public_url: 'https://shop-web.gregale.dev',
  root_dir: 'web',
  class: 'graphql',
  required_env_keys: ['API_URL'],
  depends_on: ['api'],
};
const worker = { name: 'worker', class: 'worker' };
beforeEach(() => {
  mocks.scan
    .mockResolvedValueOnce({
      workloads: [api, web, worker],
      can_apply: false,
      plan_token: 'catalog',
    })
    .mockResolvedValueOnce({
      workloads: [api, web],
      can_apply: true,
      plan_token: 'selected',
      managed: [{ name: 'db', kind: 'postgres', env_hint: 'DATABASE_URL' }],
    });
  mocks.create.mockResolvedValue({ id: 'saved' });
});
afterEach(() => vi.resetAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectMigration
        initialRepo="team/shop"
        initialRef="main"
        initialSlug="shop"
        onMigrationChange={mocks.pointer}
      />
    </QueryClientProvider>
  );
  return { user: userEvent.setup(), client };
}
async function configure(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Scan repository' }));
  expect(await screen.findByRole('checkbox', { name: /worker/ })).toBeDisabled();
  await user.click(screen.getByRole('checkbox', { name: /^api/ }));
  await user.click(screen.getByRole('checkbox', { name: /^web/ }));
  await user.click(screen.getByRole('button', { name: 'Configure selected services' }));
  await screen.findByRole('textbox', { name: 'Environment variables for api' });
}
describe('multi-service migration', () => {
  it('requires an explicit correction if a fresh review removes a chosen dependency', async () => {
    const { user } = setup();
    await configure(user);
    await user.type(
      screen.getByRole('textbox', { name: 'Environment variables for api' }),
      'DATABASE_URL=private-database'
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Environment variables for web' }),
      'API_URL=https://existing-provider.test'
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Connection for web: API_URL' }),
      'api'
    );
    const name = screen.getByRole('textbox', { name: 'Gregale app name for api' });
    await user.clear(name);
    await user.type(name, 'shop-backend');
    mocks.scan.mockResolvedValueOnce({
      workloads: [
        { ...api, app_slug: 'shop-backend' },
        { ...web, depends_on: [] },
      ],
      can_apply: true,
      plan_token: 'changed-dependencies',
    });
    await user.click(screen.getByRole('button', { name: 'Check app names' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('reviewed dependencies changed');
    expect(screen.getByRole('button', { name: 'Deploy selected services' })).toBeDisabled();
    const connection = screen.getByRole('combobox', { name: 'Connection for web: API_URL' });
    expect(connection).toHaveValue('api');
    await user.selectOptions(connection, '');
    expect(screen.getByRole('button', { name: 'Deploy selected services' })).toBeEnabled();
  });
  it('maps a runtime variable explicitly and submits the saved connection without its pasted value', async () => {
    const { user, client } = setup();
    await configure(user);
    const connection = screen.getByRole('combobox', { name: 'Connection for web: API_URL' });
    expect(connection).toHaveValue('');
    await user.type(
      screen.getByRole('textbox', { name: 'Environment variables for api' }),
      'DATABASE_URL=private-database'
    );
    await user.selectOptions(connection, 'api');
    expect(screen.getByRole('button', { name: 'Deploy selected services' })).toBeEnabled();
    expect(screen.getByText(/API_URL → https:\/\/api.internal/)).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: 'Environment variables for web' }),
      'API_URL=https://private-old-provider.test\nTOKEN=private-token'
    );
    await user.click(screen.getByRole('button', { name: 'Deploy selected services' }));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        service_connections: { web: { API_URL: 'api' } },
        initial_secrets: {
          api: { DATABASE_URL: 'private-database' },
          web: { TOKEN: 'private-token' },
        },
      })
    );
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain('private-old-provider');
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });
  it('lets customers add an undetected runtime name and explains unsupported browser variables', async () => {
    const { user } = setup();
    await configure(user);
    const input = screen.getByRole('textbox', { name: 'Add connection variable for web' });
    await user.type(input, 'VITE_API_URL');
    await user.click(screen.getByRole('button', { name: 'Add variable for web' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('public URL configured separately');
    await user.clear(input);
    await user.type(input, 'BACKEND_URL');
    await user.click(screen.getByRole('button', { name: 'Add variable for web' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Connection for web: BACKEND_URL' }),
      'api'
    );
    expect(screen.getByRole('combobox', { name: 'Connection for web: BACKEND_URL' })).toHaveValue(
      'api'
    );
    expect(screen.queryByRole('combobox', { name: /VITE_API_URL/ })).not.toBeInTheDocument();
  });
  it('requires a fresh naming review after edits, reports conflicts and preserves service configuration', async () => {
    const { user } = setup();
    await configure(user);
    await user.type(
      screen.getByRole('textbox', { name: 'Environment variables for api' }),
      'DATABASE_URL=private-connection'
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Environment variables for web' }),
      'API_URL=https://existing.example.test'
    );
    const name = screen.getByRole('textbox', { name: 'Gregale app name for api' });
    await user.clear(name);
    await user.type(name, 'taken-name');
    expect(screen.getByRole('button', { name: 'Deploy selected services' })).toBeDisabled();
    mocks.scan.mockResolvedValueOnce({
      workloads: [{ ...api, app_slug: 'taken-name' }, web],
      can_apply: false,
      can_apply_reasons: ['App name taken-name is already taken.'],
      plan_token: 'blocked',
    });
    await user.click(screen.getByRole('button', { name: 'Check app names' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already taken');
    expect(mocks.scan).toHaveBeenLastCalledWith(
      { repo: 'team/shop', ref: 'main', projectSlug: 'shop' },
      ['api', 'web'],
      expect.any(AbortSignal),
      { api: 'taken-name', web: 'shop-web' }
    );
    expect(screen.getByRole('button', { name: 'Deploy selected services' })).toBeDisabled();
    await user.clear(name);
    await user.type(name, 'shop-backend');
    mocks.scan.mockResolvedValueOnce({
      workloads: [{ ...api, app_slug: 'shop-backend' }, web],
      can_apply: true,
      plan_token: 'renamed-review',
    });
    await user.click(screen.getByRole('button', { name: 'Check app names' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Deploy selected services' })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: 'Deploy selected services' }));
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_token: 'renamed-review',
        only: ['api', 'web'],
        initial_secrets: {
          api: { DATABASE_URL: 'private-connection' },
          web: { API_URL: 'https://existing.example.test' },
        },
      })
    );
  });
  it('reviews dependencies, validates each service, submits configuration together and saves only an identity', async () => {
    const { user, client } = setup();
    await configure(user);
    expect(mocks.scan).toHaveBeenLastCalledWith(
      { repo: 'team/shop', ref: 'main', projectSlug: 'shop' },
      ['api', 'web'],
      expect.any(AbortSignal)
    );
    expect(screen.getByText(/api \(selected\)/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Gregale app name for api' })).toHaveValue(
      'shop-api'
    );
    expect(screen.getByRole('textbox', { name: 'Gregale app name for web' })).toHaveValue(
      'shop-web'
    );
    const deploy = screen.getByRole('button', { name: 'Deploy selected services' });
    expect(deploy).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: 'Environment variables for api' }),
      'DATABASE_URL=private-connection'
    );
    expect(deploy).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: 'Environment variables for web' }),
      'API_URL=https://existing.example.test'
    );
    await user.click(deploy);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    const input = mocks.create.mock.calls[0][0];
    expect(input).toEqual({
      id: expect.any(String),
      plan_token: 'selected',
      only: ['api', 'web'],
      initial_secrets: {
        api: { DATABASE_URL: 'private-connection' },
        web: { API_URL: 'https://existing.example.test' },
      },
    });
    expect(mocks.pointer).toHaveBeenCalledWith(input.id, {
      repo: 'team/shop',
      ref: 'main',
      projectSlug: 'shop',
    });
    expect(mocks.pointer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.create.mock.invocationCallOrder[0]
    );
    expect(JSON.stringify(mocks.pointer.mock.calls)).not.toContain('private-connection');
    expect(client.getMutationCache().getAll()).toHaveLength(0);
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain('private-connection');
  });
  it('clears values and inspects the saved identity after a lost response without submitting again', async () => {
    mocks.create.mockRejectedValueOnce(new TypeError('network unavailable'));
    const { user } = setup();
    await configure(user);
    await user.type(
      screen.getByRole('textbox', { name: 'Environment variables for api' }),
      'DATABASE_URL=private-connection'
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Environment variables for web' }),
      'API_URL=https://existing.example.test'
    );
    await user.click(screen.getByRole('button', { name: 'Deploy selected services' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved migration');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Could not reach the API')
    );
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(screen.queryByDisplayValue('DATABASE_URL=private-connection')).not.toBeInTheDocument();
  });
});

it('reviews a public frontend URL before building and omits its pasted secret value', async () => {
  const publicWeb = { ...web, required_env_keys: ['VITE_API_URL'], env_keys: ['VITE_API_URL'] };
  mocks.scan
    .mockReset()
    .mockResolvedValueOnce({
      workloads: [api, publicWeb, worker],
      can_apply: false,
      plan_token: 'catalog',
    })
    .mockResolvedValueOnce({
      workloads: [api, publicWeb],
      can_apply: true,
      plan_token: 'public-review',
    });
  const { user, client } = setup();
  await configure(user);
  await user.type(
    screen.getByRole('textbox', { name: 'Environment variables for api' }),
    'DATABASE_URL=private-database'
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Environment variables for web' }),
    'VITE_API_URL=https://old.example.com\nTOKEN=private-token'
  );
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Public connection for web: VITE_API_URL' }),
    'service:api'
  );
  expect(screen.getByText('VITE_API_URL → https://shop-api.gregale.dev')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Deploy selected services' })).toBeDisabled();
  await user.click(
    screen.getByRole('checkbox', {
      name: 'These URLs are public and may be included in browser bundles for web.',
    })
  );
  await user.click(screen.getByRole('button', { name: 'Deploy selected services' }));
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      public_service_connections: { web: { VITE_API_URL: 'api' } },
      initial_secrets: {
        api: { DATABASE_URL: 'private-database' },
        web: { TOKEN: 'private-token' },
      },
    })
  );
  expect(JSON.stringify(mocks.create.mock.calls)).not.toContain('old.example.com');
  expect(client.getMutationCache().getAll()).toHaveLength(0);
});

it('allows an existing public URL at build time and rejects credentials before submission', async () => {
  const publicWeb = {
    ...web,
    required_env_keys: ['NEXT_PUBLIC_API_URL'],
    env_keys: ['NEXT_PUBLIC_API_URL'],
  };
  mocks.scan
    .mockReset()
    .mockResolvedValueOnce({
      workloads: [api, publicWeb, worker],
      can_apply: false,
      plan_token: 'catalog',
    })
    .mockResolvedValueOnce({
      workloads: [api, publicWeb],
      can_apply: true,
      plan_token: 'public-review',
    });
  const { user } = setup();
  await configure(user);
  await user.type(
    screen.getByRole('textbox', { name: 'Environment variables for api' }),
    'DATABASE_URL=private-database'
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Environment variables for web' }),
    'NEXT_PUBLIC_API_URL=https://user:private@api.example.com'
  );
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Public connection for web: NEXT_PUBLIC_API_URL' }),
    'existing'
  );
  const input = screen.getByRole('textbox', { name: 'Public URL for web: NEXT_PUBLIC_API_URL' });
  expect(screen.getByRole('alert')).toHaveTextContent('without credentials');
  expect(screen.getByRole('alert')).not.toHaveTextContent('private');
  expect(screen.getByRole('button', { name: 'Deploy selected services' })).toBeDisabled();
  await user.clear(input);
  await user.type(input, 'https://existing-api.example.com/v1');
  await user.click(
    screen.getByRole('checkbox', {
      name: 'These URLs are public and may be included in browser bundles for web.',
    })
  );
  await user.click(screen.getByRole('button', { name: 'Deploy selected services' }));
  expect(mocks.create).toHaveBeenCalledWith(
    expect.objectContaining({
      public_build_urls: { web: { NEXT_PUBLIC_API_URL: 'https://existing-api.example.com/v1' } },
      initial_secrets: { api: { DATABASE_URL: 'private-database' } },
    })
  );
});

it('requires another public URL review after app names change', async () => {
  const publicWeb = { ...web, required_env_keys: ['VITE_API_URL'], env_keys: ['VITE_API_URL'] };
  mocks.scan
    .mockReset()
    .mockResolvedValueOnce({
      workloads: [api, publicWeb, worker],
      can_apply: false,
      plan_token: 'catalog',
    })
    .mockResolvedValueOnce({
      workloads: [api, publicWeb],
      can_apply: true,
      plan_token: 'public-review',
    });
  const { user } = setup();
  await configure(user);
  await user.type(
    screen.getByRole('textbox', { name: 'Environment variables for api' }),
    'DATABASE_URL=private-database'
  );
  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Public connection for web: VITE_API_URL' }),
    'service:api'
  );
  await user.click(
    screen.getByRole('checkbox', {
      name: 'These URLs are public and may be included in browser bundles for web.',
    })
  );
  const name = screen.getByRole('textbox', { name: 'Gregale app name for api' });
  await user.clear(name);
  await user.type(name, 'shop-backend');
  mocks.scan.mockResolvedValueOnce({
    workloads: [
      { ...api, app_slug: 'shop-backend', public_url: 'https://shop-backend.gregale.dev' },
      publicWeb,
    ],
    can_apply: true,
    plan_token: 'changed-public-review',
  });
  await user.click(screen.getByRole('button', { name: 'Check app names' }));
  expect(
    await screen.findByText('VITE_API_URL → https://shop-backend.gregale.dev')
  ).toBeInTheDocument();
  expect(
    screen.getByRole('checkbox', {
      name: 'These URLs are public and may be included in browser bundles for web.',
    })
  ).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Deploy selected services' })).toBeDisabled();
});

it('waits for build APIs only when explicitly selected', async () => {
  const { user } = setup();
  await configure(user);
  const wait = screen.getByRole('checkbox', { name: 'web needs api during build' });
  expect(wait).not.toBeChecked();
  await user.click(wait);
  await user.type(
    screen.getByRole('textbox', { name: 'Environment variables for api' }),
    'DATABASE_URL=private-database'
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Environment variables for web' }),
    'API_URL=https://existing.example.com'
  );
  await user.click(screen.getByRole('button', { name: 'Deploy selected services' }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalled());
  expect(mocks.create.mock.calls[0][0].build_dependencies).toEqual({ web: ['api'] });
});
