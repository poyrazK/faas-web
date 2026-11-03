import { api, unwrap } from './client';
import { ApiError } from './errors';

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
