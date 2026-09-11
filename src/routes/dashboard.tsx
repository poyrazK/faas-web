import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { DashboardShell } from '@/components/dashboard/shell';
import { hasOnboarded, hasOnboardingGitHubReturn, readSession } from '@/lib/auth';
import { validateSettingsSearch } from '@/components/dashboard/settings-search';

export const Route = createFileRoute('/dashboard')({
  // Guards run before the route loads, so a signed-out visitor never sees a
  // flash of the shell. Session lives in localStorage, so this stays sync.
  beforeLoad: ({ location }) => {
    if (!readSession()) throw redirect({ to: '/login' });
    // GitHub's callback is fixed to /dashboard/account. Let only that route
    // and its Settings destination through during onboarding, then Integrations consumes the marker
    // and sends the customer back to their first deployment.
    const returningFromOnboardingGitHub =
      (location.pathname === '/dashboard/account' ||
        (location.pathname === '/dashboard/settings' &&
          validateSettingsSearch(location.search).section === 'integrations')) &&
      hasOnboardingGitHubReturn();
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
