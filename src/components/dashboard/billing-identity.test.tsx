import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { BillingIdentityPanel } from './billing-identity';

const mocks = vi.hoisted(() => ({ toast: vi.fn(), openMfa: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/components/auth/mfa-provider', () => ({ useMfa: () => ({ openMfa: mocks.openMfa }) }));

const ok = (data: unknown, status = 200) => ({
  data,
  response: new Response(null, { status }),
});
const problem = (status: number, code: string, detail = `${code} detail`) => ({
  error: { status, code, title: code, detail },
  response: new Response(null, { status }),
});

const baseAccount = {
  id: 'acct-1',
  email: 'design@gregale.dev',
  plan: 'pro',
  status: 'active',
  business_name: 'Gregale Labs GmbH',
  billing_address: 'Torstraße 1\n10119 Berlin\nGermany',
};

type Patch = {
  path: string;
  init: { body: Record<string, string>; headers: Record<string, string> };
};
let account: Record<string, unknown>;
let patches: Patch[];

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BillingIdentityPanel />
    </QueryClientProvider>
  );
}

function patchSucceeds() {
  spyApi('PATCH').mockImplementation(async (path, init) => {
    const patch = { path, init } as Patch;
    patches.push(patch);
    account = { ...account, ...patch.init.body };
    for (const [k, v] of Object.entries(patch.init.body)) if (v === '') delete account[k];
    return ok(account) as never;
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  account = { ...baseAccount };
  patches = [];
  mocks.toast.mockReset();
  mocks.openMfa.mockReset();
  spyApi('GET').mockImplementation(async (path) => {
    if (path === '/v1/account') return ok(account) as never;
    throw new Error(`Unexpected GET ${path}`);
  });
});

describe('BillingIdentityPanel', () => {
  it('shows the saved identity, marks empty fields and says it applies to future invoices', async () => {
    mount();
    expect(await screen.findByText('Gregale Labs GmbH')).toBeInTheDocument();
    expect(screen.getByText(/Torstraße 1/)).toBeInTheDocument();
    const taxRow = screen.getByText('Tax ID').closest('div')!;
    expect(within(taxRow).getByText('Not set')).toBeInTheDocument();
    expect(screen.getByText(/issued from now on/i)).toBeInTheDocument();
  });

  it('sends only the changed fields, clears with an empty string, and shows the saved result', async () => {
    patchSucceeds();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit billing identity' }));
    const name = screen.getByLabelText('Legal name');
    await user.clear(name);
    await user.type(name, '  Gregale Labs AG ');
    await user.clear(screen.getByLabelText('Billing address'));
    await user.type(screen.getByLabelText('Tax ID'), 'DE123456789');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].path).toBe('/v1/account/billing');
    expect(patches[0].init.body).toEqual({
      business_name: 'Gregale Labs AG',
      billing_address: '',
      tax_id: 'DE123456789',
    });
    expect(patches[0].init.headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText('Gregale Labs AG')).toBeInTheDocument();
    expect(screen.getByText('DE123456789')).toBeInTheDocument();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('keeps Save disabled until something changes', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit billing identity' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText('Tax ID'), 'X');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('enforces the server byte limits before sending', async () => {
    patchSucceeds();
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit billing identity' }));
    const name = screen.getByLabelText('Legal name');
    await user.clear(name);
    // 129 characters, 258 bytes: the limit is bytes, as apid counts it.
    await user.click(name);
    await user.paste('é'.repeat(129));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/at most 256 bytes/)).toBeInTheDocument();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(patches).toHaveLength(0);
  });

  it('runs the MFA step-up on step_up_required and retries with the same idempotency key', async () => {
    let calls = 0;
    spyApi('PATCH').mockImplementation(async (path, init) => {
      patches.push({ path, init } as Patch);
      calls += 1;
      if (calls === 1) return problem(403, 'step_up_required') as never;
      account = { ...account, tax_id: 'DE123456789' };
      return ok(account) as never;
    });
    mocks.openMfa.mockImplementation((_mode: string, opts: { onVerified: () => void }) =>
      opts.onVerified()
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit billing identity' }));
    await user.type(screen.getByLabelText('Tax ID'), 'DE123456789');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('DE123456789')).toBeInTheDocument();
    expect(mocks.openMfa).toHaveBeenCalledWith('verify', expect.any(Object));
    expect(patches).toHaveLength(2);
    expect(patches[1].init.headers['Idempotency-Key']).toBe(
      patches[0].init.headers['Idempotency-Key']
    );
  });

  it('says why nothing saved when the step-up is dismissed', async () => {
    spyApi('PATCH').mockImplementation(async (path, init) => {
      patches.push({ path, init } as Patch);
      return problem(403, 'mfa_required') as never;
    });
    mocks.openMfa.mockImplementation((_mode: string, opts: { onDismissed: () => void }) =>
      opts.onDismissed()
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit billing identity' }));
    await user.type(screen.getByLabelText('Tax ID'), 'DE123456789');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/two-factor authentication/i);
    expect(mocks.openMfa).toHaveBeenCalledWith('choose', expect.any(Object));
    expect(patches).toHaveLength(1);
    expect(screen.getByLabelText('Tax ID')).toHaveValue('DE123456789');
  });

  it('shows the server explanation for any other refusal and keeps the draft', async () => {
    spyApi('PATCH').mockResolvedValue(
      problem(403, 'insufficient_scope', 'This key lacks the admin scope.') as never
    );
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit billing identity' }));
    await user.type(screen.getByLabelText('Tax ID'), 'DE123456789');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This key lacks the admin scope.');
    expect(screen.getByLabelText('Tax ID')).toHaveValue('DE123456789');
  });

  it('cancel discards the draft', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Edit billing identity' }));
    await user.type(screen.getByLabelText('Tax ID'), 'DE1');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Tax ID')).not.toBeInTheDocument();
    expect(screen.queryByText('DE1')).not.toBeInTheDocument();
  });

  it('reports a failed read with a retry instead of an empty identity', async () => {
    spyApi('GET').mockResolvedValue(problem(403, 'insufficient_scope') as never);
    mount();
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('Not set')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit billing identity' })).not.toBeInTheDocument();
  });
});
