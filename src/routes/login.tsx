import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { PasswordFlow } from '@/components/auth/password-flow';
import { ToastProvider } from '@/components/ui/toast';
import {
  AuthProvider,
  clearOAuthPending,
  hasOAuthPending,
  hasOnboarded,
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
  beforeLoad: () => {
    if (readSession()) throw redirect({ to: hasOnboarded() ? '/dashboard' : '/onboarding' });
    // OAuth returns through a full-page provider redirect. There is no
    // localStorage session hint yet, so let AuthProvider verify the HttpOnly
    // cookie before deciding that this is really a signed-out visit.
    if (hasOAuthPending()) return;
  },
  component: LoginPage,
});

function LoginPage() {
  return (
    <AuthProvider>
      <ToastProvider>
        <LoginContent />
      </ToastProvider>
    </AuthProvider>
  );
}

function LoginContent() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const { user, loading } = useAuth();
  const oauthPending = hasOAuthPending();

  // WEBSITE_URL may point at `/login` on an existing deployment. Complete the
  // same cookie-to-client handoff as the landing route in that case too.
  useEffect(() => {
    if (loading || !hasOAuthPending()) return;
    clearOAuthPending();
    if (!user) return;
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
