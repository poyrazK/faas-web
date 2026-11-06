import { vi } from 'vitest';

// Isolated panel tests omit the app's global MFA provider. Model a completed
// verification when requested; the provider and retry policy have their own
// integration tests using the real context and forms.
vi.mock('@/components/auth/mfa-provider', () => ({
  useMfa: () => ({
    openMfa: (_mode: unknown, options?: { onVerified?: (via: string) => void }) =>
      options?.onVerified?.('authenticator'),
  }),
}));
