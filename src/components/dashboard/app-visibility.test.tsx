import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const app = {
  id: 'app-id',
  slug: 'billing',
  visibility: 'public',
  url: 'https://billing.gregale.dev',
};
const read = vi.fn(
  async (_accountId: string, _slug: string, _plan: string, _signal?: AbortSignal) => ({ ...app })
);
const patch = vi.fn(async (_slug: string, _visibility: string, _signal?: AbortSignal) => ({
  ...app,
  visibility: 'internal',
}));
const invalidate = vi.fn();
vi.mock('@/lib/api/bindings', () => ({
  readAppVisibilityContext: read,
  patchAppVisibility: patch,
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({ accountId: 'account-1', state: 'available', refresh: vi.fn() }),
}));
vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: invalidate }),
}));
const { AppVisibility } = await import('./app-visibility');

beforeEach(() => {
  read.mockReset().mockImplementation(async () => ({ ...app }));
  patch.mockReset().mockImplementation(async () => ({ ...app, visibility: 'internal' }));
  invalidate.mockClear();
});

it('reviews loss of public and custom-domain reachability before saving internal visibility', async () => {
  const user = userEvent.setup();
  render(<AppVisibility accountId="account-1" plan="free" slug="billing" app={app as never} />);
  await user.selectOptions(screen.getByLabelText('App visibility'), 'internal');
  await user.click(screen.getByRole('button', { name: 'Review visibility' }));
  expect(await screen.findByText(/custom domains.*stop serving/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save visibility' }));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith('billing', 'internal', expect.any(AbortSignal))
  );
  expect(read).toHaveBeenCalledTimes(2);
});

it('requires a new review if the app changed before save', async () => {
  const user = userEvent.setup();
  render(<AppVisibility accountId="account-1" plan="free" slug="billing" app={app as never} />);
  await user.selectOptions(screen.getByLabelText('App visibility'), 'internal');
  await user.click(screen.getByRole('button', { name: 'Review visibility' }));
  await screen.findByRole('button', { name: 'Save visibility' });
  read.mockResolvedValueOnce({ ...app, visibility: 'internal' });
  await user.click(screen.getByRole('button', { name: 'Save visibility' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/changed since review/i);
  expect(patch).not.toHaveBeenCalled();
});
