import { useMfa } from './mfa-provider';
import { ApiError } from '@/lib/api/errors';

/** Retry once after fresh MFA, whichever supported second factor was used. */
export function useMfaAction() {
  const { openMfa } = useMfa();
  return async function withMfa<T>(action: () => Promise<T>, reason: string): Promise<T> {
    try {
      return await action();
    } catch (error) {
      if (
        !(error instanceof ApiError) ||
        !['mfa_required', 'step_up_required'].includes(error.code)
      ) {
        throw error;
      }
      const verified = await new Promise<boolean>((resolve) =>
        openMfa('choose', {
          reason,
          onVerified: () => resolve(true),
          onDismissed: () => resolve(false),
        })
      );
      if (!verified)
        throw new Error('Verification cancelled. Your change was not applied.', { cause: error });
      return action();
    }
  };
}
