import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { checkoutReferralKey, useCheckoutReferral } from './referrals';
import { useChangePlan } from './queries';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}
const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) });
const failure = (status: number, code: string) => ({
  error: { status, code, title: code },
  response: new Response(JSON.stringify({ status, code, title: code }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  }),
});
afterEach(() => vi.restoreAllMocks());

describe('checkout referral API', () => {
  it('keeps eligibility separate for each signed-in account', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ eligible: true }));
    const { wrapper, client } = setup();
    const { result, rerender } = renderHook(({ id }) => useCheckoutReferral(id), {
      wrapper,
      initialProps: { id: 'buyer-one' },
    });
    await waitFor(() => expect(result.current.data?.eligible).toBe(true));
    get.mockResolvedValue(ok({ eligible: false, reason: 'already_attributed', code: 'POJU43' }));
    rerender({ id: 'buyer-two' });
    await waitFor(() => expect(result.current.data?.code).toBe('POJU43'));
    expect(client.getQueryData([...checkoutReferralKey, 'buyer-one'])).toEqual({ eligible: true });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith('/v1/referrals/checkout');
  });
  it('hides the optional field while the backend program is disabled', async () => {
    spyApi('GET').mockResolvedValue(failure(404, 'not_found'));
    const { result } = renderHook(() => useCheckoutReferral('buyer'), setup());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
  it('exposes service failures without retrying or claiming eligibility', async () => {
    const get = spyApi('GET').mockResolvedValue(failure(503, 'referral_checkout_unavailable'));
    const { result } = renderHook(() => useCheckoutReferral('buyer'), setup());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(get).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBeUndefined();
  });
  it('refreshes saved attribution even when billing returns a checkout response', async () => {
    const patch = spyApi('PATCH').mockResolvedValue(failure(402, 'payment_required'));
    const { client, wrapper } = setup();
    client.setQueryData([...checkoutReferralKey, 'buyer'], { eligible: true });
    const { result } = renderHook(() => useChangePlan(), { wrapper });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ plan: 'pro', salespersonCode: ' poju43 ' })
      ).rejects.toMatchObject({ code: 'payment_required' });
    });
    expect(patch).toHaveBeenCalledWith('/v1/account/plan', {
      body: { plan: 'pro', salesperson_code: 'POJU43' },
    });
    expect(client.getQueryState([...checkoutReferralKey, 'buyer'])?.isInvalidated).toBe(true);
  });
});
