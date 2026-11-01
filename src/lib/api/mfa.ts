import { api, issueCSRF, unwrap } from './client';
import type { components } from './schema';

/*
 * MFA calls, apart from `queries.ts` because the session gate's provider
 * (`components/auth/mfa-provider.tsx`) is mounted at the root for every page;
 * the account security page reaches the same calls through `queries.ts`.
 */

export type MFAEnrollment = components['schemas']['MFAEnrollResponse'];

export function enrollMfa() {
  return unwrap(api.POST('/v1/account/mfa/enroll', {}));
}

export async function confirmMfa(totp: string) {
  const csrf_token = await issueCSRF('mfa_confirm');
  return unwrap(api.POST('/v1/account/mfa/confirm', { body: { totp, csrf_token } }));
}

export function verifyMfa(totp: string) {
  return unwrap(api.POST('/v1/account/mfa/verify', { body: { totp } }));
}

export async function recoverMfa(code: string) {
  const csrf_token = await issueCSRF('mfa_recover');
  return unwrap(api.POST('/v1/account/mfa/recover', { body: { code, csrf_token } }));
}
