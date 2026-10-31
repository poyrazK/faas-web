import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';

const workspace = vi.hoisted(() => ({
  org: null as string | null,
  label: 'Personal',
  ready: true,
}));
vi.mock('./workspace-apps', () => ({ useWorkspaceTarget: () => workspace }));

const { summarizeOrgUsage, useWorkspaceUsageSummary } = await import('./org-billing');

const MB_SECONDS_PER_GB_HOUR = 1024 * 3600;
const rows = [
  {
    app_id: 'a',
    mb_seconds: 3 * MB_SECONDS_PER_GB_HOUR,
    requests: 1,
    included_gb_hours: 200,
    cpu_usec: 1.8e9,
  },
  {
    app_id: 'b',
    mb_seconds: 1 * MB_SECONDS_PER_GB_HOUR,
    requests: 1,
    included_gb_hours: 200,
    cpu_usec: 1.8e9,
  },
];

describe('summarizeOrgUsage', () => {
  it("sums the company's apps into the allowance the overview shows", () => {
    // included_gb_hours is the organization plan's allowance, on every row
    // (faas handlers_ext.go getUsage: MustLimitsFor(acct.Plan)).
    expect(summarizeOrgUsage(rows as never, '2026-10')).toEqual({
      month: '2026-10',
      used_gb_hours: 4,
      included_gb_hours: 200,
      overage_gb_hours: 0,
      used_cpu_hours: 1,
    });
  });
  it('reports usage over the allowance', () => {
    const over = rows.map((r) => ({ ...r, included_gb_hours: 3 }));
    expect(summarizeOrgUsage(over as never, '2026-10').overage_gb_hours).toBe(1);
  });
  it('leaves the allowance unknown when no app has usage yet, rather than inventing one', () => {
    expect(summarizeOrgUsage([], '2026-10')).toEqual({
      month: '2026-10',
      used_gb_hours: 0,
      included_gb_hours: null,
      overage_gb_hours: 0,
      used_cpu_hours: 0,
    });
  });
});

type Call = {
  path: string;
  params?: { path?: Record<string, string>; query?: Record<string, string> };
};
let calls: Call[] = [];
beforeEach(() => {
  calls = [];
  workspace.org = null;
  workspace.ready = true;
  spyApi('GET').mockImplementation(async (path: string, init?: unknown) => {
    calls.push({ path, params: (init as { params?: Call['params'] })?.params });
    const data =
      path === '/v1/usage/summary'
        ? {
            month: '2026-10',
            used_gb_hours: 20,
            included_gb_hours: 100,
            overage_gb_hours: 0,
            overage_cents: 0,
          }
        : rows;
    return { data, response: new Response(null, { status: 200 }) };
  });
});
afterEach(() => vi.restoreAllMocks());

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

describe('useWorkspaceUsageSummary', () => {
  it("reads the company's usage for this month in a company workspace, never the personal summary", async () => {
    workspace.org = 'acme';
    const { result } = renderHook(() => useWorkspaceUsageSummary(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.used_gb_hours).toBe(4);
    expect(calls).toEqual([
      {
        path: '/v1/orgs/{slug}/usage',
        params: { path: { slug: 'acme' }, query: { month: new Date().toISOString().slice(0, 7) } },
      },
    ]);
  });
  it('reads the personal summary in the personal workspace', async () => {
    const { result } = renderHook(() => useWorkspaceUsageSummary(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.used_gb_hours).toBe(20);
    expect(calls.map((c) => c.path)).toEqual(['/v1/usage/summary']);
  });
  it('reads nothing until the workspace is known', async () => {
    workspace.org = 'acme';
    workspace.ready = false;
    renderHook(() => useWorkspaceUsageSummary(), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });
});
