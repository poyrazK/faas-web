import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { PasswordFlow } from '@/components/auth/password-flow';
import {
  clearOAuthPending,
  hasOAuthPending,
  hasOnboarded,
  readOAuthReturnTo,
  readSession,
  useAuth,
} from '@/lib/auth';
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
    if (readSession()) throw redirect({ to: hasOnboarded() ? '/dashboard' : '/onboarding' });
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const { user, loading } = useAuth();
  const oauthPending = hasOAuthPending();

  // WEBSITE_URL may point at `/login` on an existing deployment. Complete the
  // same cookie-to-client handoff as the landing route in that case too.
  useEffect(() => {
    if (loading || !hasOAuthPending()) return;
    const returnTo = readOAuthReturnTo();
    clearOAuthPending();
    if (!user) return;
    if (returnTo) {
      window.location.assign(returnTo);
      return;
    }
    void navigate({ to: hasOnboarded() ? '/dashboard' : '/onboarding', replace: true });
  }, [loading, navigate, user]);

  if (oauthPending && loading) {
    return (
      <AuthLayout>
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          Finishing sign-in…
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <PasswordFlow mode="signin" redirectTo={next} />
    </AuthLayout>
  );
}
