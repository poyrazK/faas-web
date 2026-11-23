import { useMfa, type MfaMethod } from './mfa-provider';

/** Only authenticator verification gives the browser session a fresh step-up stamp. */
export function useAuthenticatorStepUp() {
  const { openMfa } = useMfa();
  const prompt = (mode: 'choose' | 'verify', reason: string) =>
    new Promise<MfaMethod | null>((resolve) =>
      openMfa(mode, {
        reason,
        allowRecovery: false,
        onVerified: resolve,
        onDismissed: () => resolve(null),
      })
    );

  return async (reason: string): Promise<boolean> => {
    let method = await prompt('choose', reason);
    if (method === 'enrolment') {
      method = await prompt(
        'verify',
        'Authenticator set up. Enter a new code from your authenticator to confirm this action.'
      );
    }
    return method === 'authenticator';
  };
}
