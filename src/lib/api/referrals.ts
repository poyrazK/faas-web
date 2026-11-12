import { api, unwrap } from './client';
import { ApiError } from './errors';
import { useQuery } from '@tanstack/react-query';
import type { paths } from './schema';

export const checkoutReferralKey = ['referrals', 'checkout'] as const;
export type CheckoutReferralStatus =
  paths['/v1/referrals/checkout']['get']['responses'][200]['content']['application/json'];

export function useCheckoutReferral(accountId: string) {
  return useQuery({
    queryKey: [...checkoutReferralKey, accountId],
    enabled: Boolean(accountId),
    retry: false,
    queryFn: async (): Promise<CheckoutReferralStatus | null> => {
      try {
        return await unwrap(api.GET('/v1/referrals/checkout'));
      } catch (error) {
        // The optional program can be off or await the backend release.
        if (error instanceof ApiError && ['not_found', 'http_404'].includes(error.code))
          return null;
        throw error;
      }
    },
  });
}

/** Explicit code entry before OAuth; no referral code travels in a URL. */
export async function selectReferralCode(code: string): Promise<void> {
  try {
    await unwrap(
      api.POST('/v1/referrals/selection', { body: { referral_code: code.trim().toUpperCase() } })
    );
  } catch (error) {
    // Normal signup remains usable while the optional program is disabled or
    // the backend is awaiting its referral release.
    if (!code && error instanceof ApiError && ['not_found', 'http_404'].includes(error.code))
      return;
    throw error;
  }
}
