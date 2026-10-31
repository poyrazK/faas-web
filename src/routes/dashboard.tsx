import { useEffect } from 'react';
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from '@tanstack/react-router';
import { DashboardShell } from '@/components/dashboard/shell';
import { useToast } from '@/components/ui/toast';
import { hasOnboarded, hasOnboardingGitHubReturn, readSession, useAuth } from '@/lib/auth';
import { validateSettingsSearch } from '@/components/dashboard/settings-search';
import { validateNewAppSearch } from '@/components/dashboard/new-app-source';

export const Route = createFileRoute('/dashboard')({
  // Guards run before the route loads, so a signed-out visitor never sees a
  // flash of the shell. Session lives in localStorage, so this stays sync.
  beforeLoad: ({ location }) => {
    if (!readSession()) throw redirect({ to: '/login', search: { next: location.href } });
    // GitHub's callback is fixed to /dashboard/account. Let only that route
    // and its Settings destination through during onboarding, then Integrations consumes the marker
    // and sends the customer back to their first deployment.
    const returningFromOnboardingGitHub =
      (location.pathname === '/dashboard/account' ||
        (location.pathname === '/dashboard/settings' &&
          validateSettingsSearch(location.search).section === 'integrations')) &&
      hasOnboardingGitHubReturn();
    if (!hasOnboarded() && !returningFromOnboardingGitHub) {
      throw redirect({
        to: '/onboarding',
        search:
          location.pathname === '/dashboard/apps/new' ? validateNewAppSearch(location.search) : {},
      });
    }
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  const { sessionExpired } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const href = useRouterState({ select: (state) => state.location.href });
  // A 401 mid-use clears the session, but the guard above only runs on the
  // next navigation. Until then every panel would show an error it cannot
  // explain, so leave for sign-in now and come back to this page after.
  useEffect(() => {
    if (!sessionExpired) return;
    toast({ kind: 'info', title: 'Session expired', description: 'Sign in again to continue.' });
    void navigate({ to: '/login', search: { next: href } });
    // Leave once per expiry; `href` changing under it must not navigate again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionExpired]);
  return (
    <DashboardShell>
      <Outlet />
    </DashboardShell>
  );
}
