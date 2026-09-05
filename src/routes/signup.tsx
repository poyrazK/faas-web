import { createFileRoute, redirect } from '@tanstack/react-router';
import { AuthLayout } from '@/components/auth/auth-layout';
import { PasswordFlow } from '@/components/auth/password-flow';
import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider, hasOnboarded, readSession } from '@/lib/auth';
import { safeInternalPath } from '@/lib/redirect';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/signup')({
  head: () => pageHead({ title: 'Create account' }),
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    next: safeInternalPath(search.next),
  }),
  beforeLoad: () => {
    if (readSession()) throw redirect({ to: hasOnboarded() ? '/dashboard' : '/onboarding' });
  },
  component: SignupPage,
});

function SignupPage() {
  const { next } = Route.useSearch();
  return (
    <AuthProvider>
      <ToastProvider>
        <AuthLayout>
          <PasswordFlow mode="signup" redirectTo={next} />
        </AuthLayout>
      </ToastProvider>
    </AuthProvider>
  );
}
