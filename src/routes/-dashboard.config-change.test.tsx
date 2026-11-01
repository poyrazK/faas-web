import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { EnvBody } from '@/components/dashboard/env-page';
import { SecretsBody } from '@/components/dashboard/secrets-page';
import { spyApi } from '@/test/api';

// A write's `config_change` receipt (faas ADR-1451) reaches the person, and
// the history and guard reads refresh behind it.
const mocks = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'acct-1' } }) }));
vi.mock('@/components/dashboard/env-transfer', () => ({ EnvTransferPanel: () => null }));
vi.mock('@/components/dashboard/env-import', () => ({ EnvImportButton: () => null }));
vi.mock('@/components/dashboard/app-insights', () => ({ EnvDiffPanel: () => null }));

const ok = (data: unknown) => ({ data, response: new Response() }) as never;
const receipt = {
  revision: 7,
  guard: { id: 'g-1', status: 'watching', base_revision: 6, window_minutes: 10 },
};

function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}>{children}</QueryClientProvider>);
  return invalidate;
}

async function fill(name: string, value: string) {
  await userEvent.type(
    screen.getByPlaceholderText(name === 'env' ? 'LOG_LEVEL' : 'DATABASE_URL'),
    'LOG_LEVEL'
  );
  const valueBox = screen.getByPlaceholderText(
    name === 'env' ? 'debug' : 'Never shown again once saved'
  );
  await userEvent.type(valueBox, value);
}

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.toast.mockReset();
  spyApi('GET').mockResolvedValue(ok({ env: [], secrets: [], count: 0, quota_max: 16 }));
});

describe('config change receipts', () => {
  it('names the revision and the guard after a variable write', async () => {
    spyApi('PUT').mockResolvedValue(
      ok({ key: 'LOG_LEVEL', scope: 'default', config_change: receipt })
    );
    const invalidate = mount(<EnvBody slug="checkout" />);
    await fill('env', 'debug');
    await userEvent.click(screen.getByRole('button', { name: /Save variable/ }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        kind: 'success',
        title: 'Variable saved',
        description: expect.stringMatching(/Config revision 7\. The config guard watches/),
      })
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['apps', 'checkout', 'config'] });
  });

  it('names the revision and the guard after a secret write', async () => {
    spyApi('PUT').mockResolvedValue(
      ok({
        key: 'LOG_LEVEL',
        scope: 'default',
        secret_class: 'persistent',
        delivery_version: 1,
        delivery_status: 'delivered',
        created_at: '2026-10-31T00:00:00Z',
        updated_at: '2026-10-31T00:00:00Z',
        config_change: { revision: 8 },
      })
    );
    const invalidate = mount(<SecretsBody slug="checkout" />);
    await fill('secret', 'hunter2-hunter2');
    await userEvent.click(screen.getByRole('button', { name: /Save secret/ }));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith({
        kind: 'success',
        title: 'Secret saved',
        description: 'Recorded as config revision 8.',
      })
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['apps', 'checkout', 'config'] });
  });
});
