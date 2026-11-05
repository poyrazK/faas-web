import type { OnboardingDraft } from './onboarding-draft';

export type OnboardingProgress =
  'preparing' | 'unknown' | 'deploying' | 'failed' | 'live' | 'unavailable' | 'mismatch';
export function onboardingProgress(input: {
  draft: OnboardingDraft;
  app?: { id: string };
  deployment?: { app_id: string; status: string };
  loading?: boolean;
  error?: unknown;
}): OnboardingProgress {
  if (input.error || input.loading) return 'unavailable';
  if (input.deployment && (!input.app || input.deployment.app_id !== input.app.id))
    return 'mismatch';
  if (
    input.draft.phase === 'creating' ||
    input.draft.phase === 'submitting' ||
    input.draft.phase === 'unknown'
  )
    return 'unknown';
  if (!input.draft.app) return 'preparing';
  if (!input.draft.deployment) return input.draft.phase === 'rejected' ? 'failed' : 'unknown';
  if (!input.deployment) return 'unavailable';
  if (input.deployment.status === 'live') return 'live';
  if (['failed', 'cancelled', 'superseded'].includes(input.deployment.status)) return 'failed';
  return 'deploying';
}
