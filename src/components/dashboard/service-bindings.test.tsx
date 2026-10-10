import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const capability = { accountId: 'account-1', state: 'available', refresh: vi.fn() };
const app = {
  data: {
    id: 'app-id',
    slug: 'app-a',
    visibility: 'internal',
    service_binding_policy: 'declared',
    service_binding_transport: 'http',
    service_bindings: [{ service: 'billing', binding: 'GREGALE_SERVICE_BILLING_URL' }],
    allowed_service_callers: [],
  },
  isPending: false,
  error: null,
  refetch: vi.fn(),
};
const inventory = {
  data: {
    app: 'app-a',
    generated_at: '2026-10-10T00:00:00Z',
    complete: false,
    bindings: [
      {
        type: 'service',
        name: 'billing',
        binding: 'GREGALE_SERVICE_BILLING_URL',
        scope: 'app',
        access: 'declared',
        state: 'enforced',
        runtime_status: 'unknown',
        verification_status: 'stale',
        http_url: 'http://billing.svc.gregale:10081',
      },
    ],
    issues: [
      {
        type: 'postgres',
        code: 'forbidden',
        severity: 'error',
        message: 'Postgres inventory is restricted.',
      },
    ],
  },
  isPending: false,
  error: null,
  refetch: vi.fn(),
};
const ownership = {
  data: { kind: 'project', projectSlug: 'shop' } as { kind: string; projectSlug?: string },
  isPending: false,
  error: null,
  refetch: vi.fn(),
};
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account-1' } }) }));
vi.mock('@/lib/api/capabilities', () => ({ useCapability: () => capability }));
vi.mock('@/lib/api/queries', () => ({
  useApp: () => app,
  keys: { apps: ['apps'], app: () => ['apps', 'app-a'] },
}));
vi.mock('@/lib/api/bindings', () => ({
  useBindingInventory: () => inventory,
  useAppPolicyOwnership: () => ownership,
  patchServicePolicy: vi.fn(),
  bindingInventoryKey: () => ['bindings'],
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
const { ServiceBindings } = await import('./service-bindings');

beforeEach(() => {
  capability.state = 'available';
  ownership.data = { kind: 'project', projectSlug: 'shop' };
});

it('shows partial inventory and stale canary evidence without making internal addresses public links', () => {
  render(<ServiceBindings slug="app-a" />);
  expect(screen.getByText(/inventory is partial/i)).toBeInTheDocument();
  expect(screen.getByText('Postgres inventory is restricted.')).toBeInTheDocument();
  expect(screen.getByText(/canary stale/i)).toBeInTheDocument();
  expect(screen.getByDisplayValue('http://billing.svc.gregale:10081')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /billing.svc.gregale/i })).not.toBeInTheDocument();
  expect(screen.getByText(/no internal callers are allowed/i)).toBeInTheDocument();
});

it('keeps project-owned policies read-only with a source handoff', () => {
  render(<ServiceBindings slug="app-a" />);
  expect(screen.getByText(/project shop owns these service policies/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /save service policy/i })).not.toBeInTheDocument();
});
