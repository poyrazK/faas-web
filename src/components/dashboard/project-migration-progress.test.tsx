import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { ProjectMigrationProgress } from './project-migration-progress';
const mocks = vi.hoisted(() => ({ get: vi.fn(), resume: vi.fn(), scan: vi.fn() }));
vi.mock('@/lib/api/project-migration', () => ({
  getProjectMigration: mocks.get,
  resumeProjectMigration: mocks.resume,
  scanMigrationProject: mocks.scan,
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'owner' } }) }));
vi.mock('@/lib/use-unsaved-guard', () => ({ useUnsavedGuard: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock('./migration-verification', () => ({
  MigrationVerification: ({
    app,
    deployment,
    serviceConnections,
  }: {
    app: string;
    deployment: string;
    serviceConnections?: unknown[];
  }) => (
    <div>
      Verification for {app} {deployment}
      {!!serviceConnections?.length && <span>{JSON.stringify(serviceConnections)}</span>}
    </div>
  ),
}));
const services = [
  {
    name: 'api',
    app: 'shop-api',
    app_id: 'a',
    deployment_id: 'dep-api',
    status: 'failed',
    attempt: 1,
    configured_keys: ['DATABASE_URL'],
    required_env_keys: ['DATABASE_URL'],
    depends_on: [],
  },
  {
    name: 'web',
    app: 'shop-web',
    app_id: 'b',
    deployment_id: 'dep-web',
    status: 'live',
    attempt: 1,
    configured_keys: [],
    required_env_keys: [],
    depends_on: ['api'],
  },
];
const record = {
  id: 'migration-id',
  version: 4,
  project: 'shop',
  project_id: 'project',
  source_sha256: 'source-hash',
  status: 'attention',
  services,
};
afterEach(() => vi.resetAllMocks());
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ProjectMigrationProgress
        id="migration-id"
        source={{ repo: 'team/shop', ref: 'original', projectSlug: 'shop' }}
      />
    </QueryClientProvider>
  );
  return { client, user: userEvent.setup() };
}
it('resumes only failed services and keeps secret values out of query and mutation caches', async () => {
  mocks.get.mockResolvedValue(record);
  mocks.scan.mockResolvedValue({ plan_token: 'same-reviewed-source', can_apply: true });
  mocks.resume.mockResolvedValue({
    ...record,
    services: [
      { ...services[0], status: 'building', attempt: 2, deployment_id: 'retry-api' },
      services[1],
    ],
  });
  const { user, client } = setup();
  await user.click(await screen.findByRole('button', { name: 'Review unfinished services' }));
  expect(screen.getByText('Verification for shop-web dep-web')).toBeInTheDocument();
  expect(
    screen.queryByRole('textbox', { name: /Correct configuration for web/ })
  ).not.toBeInTheDocument();
  await user.type(
    screen.getByRole('textbox', { name: /Correct configuration for api/ }),
    'DATABASE_URL=corrected-private'
  );
  await user.click(screen.getByRole('button', { name: 'Resume unfinished services' }));
  await waitFor(() =>
    expect(mocks.resume).toHaveBeenCalledWith('migration-id', {
      plan_token: 'same-reviewed-source',
      expected_version: 4,
      only: ['api'],
      initial_secrets: { api: { DATABASE_URL: 'corrected-private' } },
    })
  );
  expect(mocks.scan).toHaveBeenCalledWith(
    { repo: 'team/shop', ref: 'original', projectSlug: 'shop' },
    ['api'],
    undefined,
    { api: 'shop-api' }
  );
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data)
    )
  ).not.toContain('corrected-private');
});

it('restores saved connections on retry and never submits pasted replacements', async () => {
  const connected = {
    ...record,
    services: [
      { ...services[0], status: 'live' },
      {
        ...services[1],
        status: 'failed',
        service_connections: { API_URL: 'api' },
        public_service_connections: { VITE_API_URL: 'api' },
        public_build_urls: { VITE_API_URL: 'https://shop-api.gregale.dev' },
        configured_keys: ['API_URL', 'VITE_API_URL'],
      },
    ],
  };
  mocks.get.mockResolvedValue(connected);
  mocks.scan.mockResolvedValue({ plan_token: 'reviewed-retry', can_apply: true });
  mocks.resume.mockResolvedValue(connected);
  const { user } = setup();
  await user.click(await screen.findByRole('button', { name: 'Review unfinished services' }));
  expect(screen.getByText(/API_URL → api on Gregale/)).toBeInTheDocument();
  expect(screen.getByText(/VITE_API_URL → https:\/\/shop-api.gregale.dev/)).toBeInTheDocument();
  await user.type(
    screen.getByRole('textbox', { name: /Correct configuration for web/ }),
    'API_URL=https://private-old-provider.test\nVITE_API_URL=https://private-public-override.example.com'
  );
  await user.click(screen.getByRole('button', { name: 'Resume unfinished services' }));
  await waitFor(() =>
    expect(mocks.resume).toHaveBeenCalledWith('migration-id', {
      expected_version: 4,
      only: ['web'],
      plan_token: 'reviewed-retry',
    })
  );
});

it('waits for connected targets and passes their saved deployment identities to verification', async () => {
  const connected = {
    ...record,
    services: [services[0], { ...services[1], service_connections: { API_URL: 'api' } }],
  };
  mocks.get.mockResolvedValueOnce(connected).mockResolvedValue({
    ...connected,
    services: [{ ...services[0], status: 'live' }, connected.services[1]],
  });
  const { user } = setup();
  expect(await screen.findByText(/Wait for the connected services/)).toBeInTheDocument();
  expect(screen.queryByText('Verification for shop-web dep-web')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Check saved progress' }));
  await user.click(await screen.findByRole('button', { name: 'Verify and cut over web' }));
  expect(
    await screen.findByText(/"env_key":"API_URL","service":"api","deployment_id":"dep-api"/)
  ).toBeInTheDocument();
});
it('loads a saved migration without creating or resuming work', async () => {
  mocks.get.mockResolvedValue(record);
  setup();
  expect(await screen.findByText('Deployment dep-web')).toBeInTheDocument();
  expect(mocks.resume).not.toHaveBeenCalled();
  expect(mocks.scan).not.toHaveBeenCalled();
});
it('blocks retry when an app changed outside the migration', async () => {
  mocks.get.mockResolvedValue({
    ...record,
    services: [{ ...services[0], status: 'changed' }, services[1]],
  });
  setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('changed outside this migration');
  expect(
    screen.queryByRole('button', { name: 'Review unfinished services' })
  ).not.toBeInTheDocument();
});

it('keeps the saved app mapping and blocks resume when names are unavailable', async () => {
  mocks.get.mockResolvedValue(record);
  mocks.scan.mockResolvedValue({
    plan_token: 'blocked',
    can_apply: false,
    can_apply_reasons: ['shop-api is held by a deleted app.'],
  });
  const { user } = setup();
  await user.click(await screen.findByRole('button', { name: 'Review unfinished services' }));
  await user.click(screen.getByRole('button', { name: 'Resume unfinished services' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('held by a deleted app');
  expect(mocks.scan).toHaveBeenCalledWith(
    { repo: 'team/shop', ref: 'original', projectSlug: 'shop' },
    ['api'],
    undefined,
    { api: 'shop-api' }
  );
  expect(mocks.resume).not.toHaveBeenCalled();
});

it('restores a waiting build with its blocker and deadline after reload', async () => {
  mocks.get.mockResolvedValue({
    ...record,
    status: 'tracking',
    services: [
      { ...services[0], status: 'live' },
      {
        ...services[1],
        status: 'waiting',
        build_dependencies: ['api'],
        build_wait: {
          status: 'waiting',
          code: 'build_dependency_not_ready',
          detail: 'Waiting for API api to serve all traffic.',
          deadline_at: '2026-10-17T21:00:00Z',
        },
      },
    ],
  });
  setup();
  expect(await screen.findByText(/Waiting for API api to serve all traffic/)).toHaveTextContent(
    'You can close this page.'
  );
  expect(screen.getByText(/APIs required during build: api/)).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Review unfinished services' })
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Cancel this waiting deployment from its app/)).toBeInTheDocument();
  expect(mocks.resume).not.toHaveBeenCalled();
});
