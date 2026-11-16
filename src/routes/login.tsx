import { featureFlags } from '@/lib/feature-flags';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState } from 'react';
import { OAuthHandoff } from '@/components/auth/oauth-handoff';
import { AuthLayout } from '@/components/auth/auth-layout';
import { PasswordFlow } from '@/components/auth/password-flow';
import { hasOAuthPending, hasOnboarded, readSession, useAuth } from '@/lib/auth';
import { safeInternalPath } from '@/lib/redirect';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/login')({
  head: () => pageHead({ title: 'Sign in' }),
  validateSearch: (search: Record<string, unknown>): { next?: string; reauth?: 1 } => ({
    next: safeInternalPath(search.next),
    reauth: search.reauth === '1' || search.reauth === 1 || search.reauth === true ? 1 : undefined,
  }),
  beforeLoad: ({ search }) => {
    // The server requires a fresh session before authorizing an agent. A
    // stored session hint cannot satisfy that requirement: redirecting it
    // straight back to `next` loops until the failed-auth limiter stops it.
    if (search.reauth) return;
    // OAuth returns through a full-page provider redirect. There is no
    // reliable session hint yet. Restore the pending destination only after
    // AuthProvider verifies the cookie, even if an older hint is present.
    if (hasOAuthPending()) return;
    if (readSession() && search.next) throw redirect({ href: search.next, reloadDocument: true });
    if (readSession())
      throw redirect({
        to: featureFlags.onboardingV2
          ? '/onboarding'
          : hasOnboarded()
            ? '/dashboard'
            : '/onboarding',
      });
  },
  component: LoginPage,
});

function LoginPage() {
  const { next, reauth } = Route.useSearch();
  const [returning] = useState(hasOAuthPending);
  const { sessionError } = useAuth();
  if (!reauth && returning && (hasOAuthPending() || sessionError))
    return (
      <AuthLayout>
        <OAuthHandoff />
      </AuthLayout>
    );

  return (
    <AuthLayout>
      <PasswordFlow
        mode="signin"
        redirectTo={next}
        description={reauth ? 'Sign in again to continue authorizing your connection.' : undefined}
      />
    </AuthLayout>
  );
}
