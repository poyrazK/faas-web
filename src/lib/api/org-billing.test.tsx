import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { ApiError } from './errors';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('./workspace-apps', () => ({
  useWorkspaceTarget: () => workspace,
  useOrgApps: () => ({ data: { apps: [{ id: 'app-1', slug: 'shop-api' }] } }),
}));
vi.mock('@/lib/api/workspace-apps', () => ({
  useWorkspaceTarget: () => workspace,
  useOrgApps: () => ({ data: { apps: [{ id: 'app-1', slug: 'shop-api' }] } }),
}));

const { useInfiniteInvoices, useBillingPortal } = await import('./queries');
const { OrgUsage, OrgPlanSummary, orgBillingMessage } =
  await import('@/components/dashboard/org-billing');

type Call = { method: string; path: string; params?: { path?: Record<string, string> } };
let calls: Call[] = [];
let forbid = false;
const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const forbidden = () => ({
  error: { code: 'org_role_forbidden', title: 'Forbidden', status: 403 },
  response: new Response(
    JSON.stringify({ code: 'org_role_forbidden', title: 'Forbidden', status: 403 }),
    { status: 403, headers: { 'content-type': 'application/problem+json' } }
  ),
});

beforeEach(() => {
  calls = [];
  forbid = false;
  workspace.org = 'acme';
  workspace.label = 'Acme';
  spyApi('GET').mockImplementation(async (path: string, init?: unknown) => {
    calls.push({ method: 'GET', path, params: (init as { params?: Call['params'] })?.params });
    if (forbid) return forbidden();
    if (path.endsWith('/invoices')) return ok({ items: [], next_before: null });
    if (path.endsWith('/usage'))
      return ok([{ app_id: 'app-1', mb_seconds: 3_686_400, requests: 1200, cold_boots: 3 }]);
    if (path.endsWith('/billing/status')) return ok({ plan: 'pro', account_status: 'active' });
    if (path.endsWith('/billing/portal')) return ok({ url: 'https://billing.example/p' });
    return ok({});
  });
});
afterEach(() => vi.restoreAllMocks());

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client()}>{children}</QueryClientProvider>
);

describe('company billing reads', () => {
  it("reads the organization's invoices, never the personal ones", async () => {
    const { result } = renderHook(() => useInfiniteInvoices(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toEqual([
      expect.objectContaining({
        path: '/v1/orgs/{slug}/invoices',
        params: expect.objectContaining({ path: { slug: 'acme' } }),
      }),
    ]);
  });
  it('keeps the personal invoices in the personal workspace', async () => {
    workspace.org = null;
    const { result } = renderHook(() => useInfiniteInvoices(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(calls.map((c) => c.path)).toEqual(['/v1/invoices']);
  });
  it("opens the organization's billing portal", async () => {
    const { result } = renderHook(() => useBillingPortal(), { wrapper });
    await result.current.mutateAsync();
    expect(calls.map((c) => c.path)).toEqual(['/v1/orgs/{slug}/billing/portal']);
  });
  it('lists the organization usage per app', async () => {
    render(<OrgUsage org="acme" label="Acme" />, { wrapper });
    // Rows carry app ids; the organization's app list names them.
    expect(await screen.findByText('shop-api')).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ path: '/v1/orgs/{slug}/usage' });
    expect(calls.some((c) => c.path.startsWith('/v1/usage'))).toBe(false);
  });
  it("names the organization's plan from its billing status", async () => {
    render(<OrgPlanSummary org="acme" label="Acme" />, { wrapper });
    expect(await screen.findByText(/Acme is on the Pro plan/)).toBeInTheDocument();
  });
  it('tells a member without a billing role who can see it', async () => {
    forbid = true;
    render(<OrgUsage org="acme" label="Acme" />, { wrapper });
    expect(
      // Usage needs only membership (OrgActionView), so the refusal names the
      // member's role rather than claiming only owners may see it.
      await screen.findByText('Your role in Acme cannot see its usage.')
    ).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith('/v1/usage'))).toBe(false);
  });
  it('words the role refusal for invoices too', () => {
    expect(
      orgBillingMessage(
        new ApiError({ code: 'org_role_forbidden', status: 403, title: 'Forbidden' }),
        'Acme',
        'invoices'
      )
    ).toBe("Only Acme's owners and billing admins can see its invoices.");
  });
});
