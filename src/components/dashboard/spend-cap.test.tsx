import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
const toast = vi.hoisted(() => vi.fn());
const openMfa = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/auth/mfa-provider', () => ({ useMfa: () => ({ openMfa }) }));

const { SpendCap } = await import('./spend-cap');

type Call = {
  method: 'GET' | 'POST';
  path: string;
  init?: {
    params?: { path?: Record<string, string> };
    headers?: Record<string, string>;
    body?: unknown;
  };
};
let calls: Call[];
let orgCap: number | null;
let postReplies: (() => unknown)[];

const problem = (code: string, status: number) => ({
  error: { code, title: code, status },
  response: new Response(JSON.stringify({ code, title: code, status }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  }),
});
const ok = (data: unknown) => ({ data, response: new Response() });

beforeEach(() => {
  calls = [];
  orgCap = 1000;
  postReplies = [];
  toast.mockReset();
  openMfa.mockReset();
  spyApi('GET').mockImplementation(async (path, init) => {
    calls.push({ method: 'GET', path, init: init as Call['init'] });
    if (path === '/v1/orgs/{slug}/overage-cap') return ok({ overage_cap_cents: orgCap }) as never;
    if (path === '/v1/account/overage-cap') return ok({ overage_cap_cents: 500 }) as never;
    throw new Error(`Unexpected GET ${path}`);
  });
  spyApi('POST').mockImplementation(async (path, init) => {
    calls.push({ method: 'POST', path, init: init as Call['init'] });
    const next = postReplies.shift();
    if (next) return next() as never;
    const body = (init as { body: { overage_cap_cents: number | null } }).body;
    return ok(body) as never;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  workspace.org = null;
  workspace.label = 'Personal';
  workspace.ready = true;
});

function mount() {
  return act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <SpendCap />
      </QueryClientProvider>
    );
  });
}

async function setCap(amount: string) {
  const input = await screen.findByRole('spinbutton', { name: 'Cap (USD)' });
  await userEvent.clear(input);
  await userEvent.type(input, amount);
  await userEvent.click(screen.getByRole('button', { name: 'Set cap' }));
}

const company = () => {
  workspace.org = 'acme';
  workspace.label = 'Acme';
};

describe('SpendCap in a company workspace', () => {
  it("reads and writes the organization's cap and never the personal one", async () => {
    company();
    await mount();
    expect(await screen.findByText('$10.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: "About Acme's spend cap" }));
    expect(screen.getByText(/Acme's apps/)).toBeInTheDocument();
    await setCap('25');
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1));
    const write = calls.find((c) => c.method === 'POST')!;
    expect(write.path).toBe('/v1/orgs/{slug}/overage-cap');
    expect(write.init?.params?.path).toEqual({ slug: 'acme' });
    expect(write.init?.body).toEqual({ overage_cap_cents: 2500 });
    expect(write.init?.headers?.['Idempotency-Key']).toMatch(/\S/);
    expect(await screen.findByText('$25.00')).toBeInTheDocument();
    expect(calls.every((c) => c.path === '/v1/orgs/{slug}/overage-cap')).toBe(true);
    expect(calls.some((c) => c.path === '/v1/account/overage-cap')).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: "Acme's spend cap set to $25.00" })
    );
  });

  it('clears the organization cap with null, not the personal one', async () => {
    company();
    await mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Clear cap' }));
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')?.init?.body).toEqual({
        overage_cap_cents: null,
      })
    );
    expect(calls.find((c) => c.method === 'POST')?.path).toBe('/v1/orgs/{slug}/overage-cap');
    expect(await screen.findByText('No cap set')).toBeInTheDocument();
  });

  it("names the organization when the member's role cannot change the cap", async () => {
    company();
    postReplies = [() => problem('org_role_forbidden', 403)];
    await mount();
    await setCap('25');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Only Acme's owner can change its spend cap."
    );
    // The saved cap is still the one shown.
    expect(screen.getByText('$10.00')).toBeInTheDocument();
  });

  it("names the organization when the member's role cannot read the cap", async () => {
    company();
    spyApi('GET').mockImplementation(async (path) => {
      calls.push({ method: 'GET', path });
      return problem('org_role_forbidden', 403) as never;
    });
    await mount();
    expect(
      await screen.findByText('Your role in Acme cannot see its spend cap.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('spinbutton', { name: 'Cap (USD)' })).toBeNull();
    expect(calls.map((c) => c.path)).toEqual(['/v1/orgs/{slug}/overage-cap']);
  });

  it('asks for a step-up and replays the same write with the same key', async () => {
    company();
    postReplies = [() => problem('step_up_required', 403)];
    openMfa.mockImplementation((_mode: string, opts: { onVerified: () => void }) =>
      opts.onVerified()
    );
    await mount();
    await setCap('7.50');
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    expect(openMfa).toHaveBeenCalledWith('verify', expect.anything());
    const [first, second] = calls.filter((c) => c.method === 'POST');
    expect(second.init?.headers?.['Idempotency-Key']).toBe(
      first.init?.headers?.['Idempotency-Key']
    );
    expect(second.init?.body).toEqual({ overage_cap_cents: 750 });
    expect(await screen.findByText('$7.50')).toBeInTheDocument();
  });

  it('says what is needed when the step-up is dismissed', async () => {
    company();
    postReplies = [() => problem('step_up_required', 403)];
    openMfa.mockImplementation((_mode: string, opts: { onDismissed: () => void }) =>
      opts.onDismissed()
    );
    await mount();
    await setCap('7.50');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Verify with your authenticator to change Acme's spend cap."
    );
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('reads nothing until the workspace is known', async () => {
    workspace.ready = false;
    await mount();
    expect(calls).toEqual([]);
    expect(screen.queryByText(/Reading spend cap/)).toBeNull();
  });
});

describe('SpendCap in the personal workspace', () => {
  it("reads and writes the signed-in account's cap only", async () => {
    await mount();
    expect(await screen.findByText('$5.00')).toBeInTheDocument();
    await setCap('12');
    await waitFor(() =>
      expect(calls.find((c) => c.method === 'POST')).toMatchObject({
        path: '/v1/account/overage-cap',
        init: { body: { overage_cap_cents: 1200 } },
      })
    );
    expect(calls.some((c) => c.path.startsWith('/v1/orgs/'))).toBe(false);
  });

  it('says a $0 cap stops workloads even within the allowance', async () => {
    spyApi('GET').mockImplementation(async () => ok({ overage_cap_cents: 0 }) as never);
    await mount();
    // A $0 cap counts as reached at once (faas docs/billing.md:33-35,
    // pkg/sched/overage.go:207), so "no overage" would undersell it.
    expect(await screen.findByText('$0.00 · Workloads paused')).toBeInTheDocument();
  });
});
