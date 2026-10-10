import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const app = {
  id: 'app-id',
  slug: 'billing',
  visibility: 'internal',
  allowed_service_callers: ['frontend'],
  service_bindings: [{ service: 'identity', binding: 'GREGALE_SERVICE_IDENTITY_URL' }],
  service_binding_policy: 'declared',
  service_binding_transport: 'http',
};
const readContext = vi.fn(
  async (_accountId: string, _slug: string, _plan: string, _signal?: AbortSignal) => ({
    app: { ...app },
    choices: ['billing', 'frontend', 'identity'],
  })
);
const patch = vi.fn(async (_slug: string, _body: unknown, _signal?: AbortSignal) => ({
  ...app,
  allowed_service_callers: [],
}));
const invalidate = vi.fn();
vi.mock('@/lib/api/bindings', () => ({
  readServicePolicyContext: readContext,
  patchServicePolicy: patch,
  bindingInventoryKey: () => ['bindings'],
  policyOwnershipKey: () => ['ownership'],
  accountAppChoicesKey: () => ['choices'],
  useAccountAppChoices: () => ({
    data: [{ slug: 'billing' }, { slug: 'frontend' }, { slug: 'identity' }],
    isPending: false,
    error: null,
  }),
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
const { ServicePolicyEditor } = await import('./service-policy-editor');

beforeEach(() => {
  readContext.mockReset().mockImplementation(async () => ({
    app: { ...app },
    choices: ['billing', 'frontend', 'identity'],
  }));
  patch.mockReset().mockImplementation(async () => ({ ...app, allowed_service_callers: [] }));
  invalidate.mockClear();
});

it('reviews deny-all before saving and rechecks context immediately before PATCH', async () => {
  const user = userEvent.setup();
  render(
    <ServicePolicyEditor
      accountId="account-1"
      plan="free"
      slug="billing"
      app={app as never}
      inventoryComplete
    />
  );
  await user.selectOptions(screen.getByLabelText('Allowed callers'), 'deny');
  await user.click(screen.getByRole('button', { name: 'Review service policy' }));
  expect(await screen.findByText(/Target callers: no internal callers/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save service policy' }));
  await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
  expect(readContext).toHaveBeenCalledTimes(2);
  expect(patch.mock.calls[0][1]).toMatchObject({ allowed_service_callers: [] });
});

it('rejects a stale review when policy changes before submit', async () => {
  const user = userEvent.setup();
  render(
    <ServicePolicyEditor
      accountId="account-1"
      plan="free"
      slug="billing"
      app={app as never}
      inventoryComplete
    />
  );
  await user.selectOptions(screen.getByLabelText('Allowed callers'), 'deny');
  await user.click(screen.getByRole('button', { name: 'Review service policy' }));
  await screen.findByRole('button', { name: 'Save service policy' });
  readContext.mockResolvedValueOnce({
    app: { ...app, service_binding_policy: 'account' },
    choices: ['billing', 'frontend', 'identity'],
  });
  await user.click(screen.getByRole('button', { name: 'Save service policy' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed since review/i);
  expect(patch).not.toHaveBeenCalled();
});
