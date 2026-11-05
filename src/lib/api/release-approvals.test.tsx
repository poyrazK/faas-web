import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { ApiError } from './errors';
import { approvalPath, useApprovalPolicy, useDecideRelease } from './release-approvals';
import { gateRule } from './release-gates';

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) }) as never;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

afterEach(() => vi.restoreAllMocks());

describe('release approvals', () => {
  it('links to the approval page the notifications open', () => {
    expect(approvalPath('abc')).toBe('/dashboard/releases/abc/approval');
  });

  it('reads an app without a policy as no policy, not an error', async () => {
    spyApi('GET').mockRejectedValue(
      new ApiError({
        status: 404,
        code: 'release_approval_policy_not_found',
        title: 'No approval policy',
      })
    );
    const { result } = renderHook(() => useApprovalPolicy('shop'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('keeps any other policy failure an error', async () => {
    spyApi('GET').mockRejectedValue(new ApiError({ status: 404, code: 'not_found', title: 'x' }));
    const { result } = renderHook(() => useApprovalPolicy('shop'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('sends one decision, with its comment, to the release', async () => {
    const post = spyApi('POST').mockResolvedValue(ok({ state: 'rejected' }));
    const { result } = renderHook(() => useDecideRelease(), { wrapper });
    await act(() =>
      result.current.mutateAsync({ id: 'd1', decision: 'reject', comment: 'latency' })
    );
    expect(post).toHaveBeenCalledWith(
      '/v1/deployments/{id}/approvals',
      expect.objectContaining({
        params: { path: { id: 'd1' } },
        body: { decision: 'reject', comment: 'latency' },
      })
    );
  });
});

describe('gateRule', () => {
  const base = { name: 'g', min_samples: 20, created_by: 'me', created_at: '' };
  it('says what each kind of gate fails on', () => {
    expect(gateRule({ ...base, kind: 'slo', slo: 'checkout', max_burn_rate: 10 })).toBe(
      'SLO checkout burning faster than 10×'
    );
    expect(gateRule({ ...base, kind: 'new_errors', max_new_groups: 0, min_events: 3 })).toMatch(
      /More than 0 new error group/
    );
    expect(
      gateRule({
        ...base,
        kind: 'metric_change',
        metric: 'orders',
        comparison: 'below',
        max_change_percent: 30,
      })
    ).toBe('orders drops more than 30% from before the rollout');
    expect(
      gateRule({
        ...base,
        kind: 'custom_metric',
        metric: 'orders',
        comparison: 'below',
        threshold: 5,
      })
    ).toBe('orders average below 5');
    expect(
      gateRule({ ...base, kind: 'synthetic', check: 'checkout', max_failure_percent: 10 })
    ).toMatch(/Check checkout failing more than 10%/);
    expect(
      gateRule({ ...base, kind: 'ai', metric: 'cost_per_call', max_increase_percent: 30 })
    ).toMatch(/AI cost_per_call more than 30% worse/);
  });
});
