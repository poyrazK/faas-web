import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { DashboardShell } from '@/components/dashboard/shell';
import { hasOnboarded, hasOnboardingGitHubReturn, readSession } from '@/lib/auth';

export const Route = createFileRoute('/dashboard')({
  // Guards run before the route loads, so a signed-out visitor never sees a
  // flash of the shell. Session lives in localStorage, so this stays sync.
  beforeLoad: ({ location }) => {
    if (!readSession()) throw redirect({ to: '/login' });
    // GitHub's callback is fixed to /dashboard/account. Let only that route
    // through during onboarding, then the account page consumes the marker
    // and sends the customer back to their first deployment.
    const returningFromOnboardingGitHub =
      location.pathname === '/dashboard/account' && hasOnboardingGitHubReturn();
    if (!hasOnboarded() && !returningFromOnboardingGitHub) {
      throw redirect({ to: '/onboarding' });
    }
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <DashboardShell>
      <Outlet />
    </DashboardShell>
  );
}
