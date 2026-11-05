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
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: safeInternalPath(search.next),
  }),
  beforeLoad: ({ search }) => {
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
  const { next } = Route.useSearch();
  const [returning] = useState(hasOAuthPending);
  const { sessionError } = useAuth();
  if (returning && (hasOAuthPending() || sessionError))
    return (
      <AuthLayout>
        <OAuthHandoff />
      </AuthLayout>
    );

  return (
    <AuthLayout>
      <PasswordFlow mode="signin" redirectTo={next} />
    </AuthLayout>
  );
}
