import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { MfaProvider } from '@/components/auth/mfa-provider';
import { DashboardShell } from '@/components/dashboard/shell';
import { AppQueryProvider } from '@/components/query-provider';
import { ToastProvider } from '@/components/ui/toast';
import { AuthProvider, hasOnboarded, readSession } from '@/lib/auth';
import { DataProvider } from '@/lib/store';

export const Route = createFileRoute('/dashboard')({
  // Guards run before the route loads, so a signed-out visitor never sees a
  // flash of the shell. Session lives in localStorage, so this stays sync.
  beforeLoad: () => {
    if (!readSession()) throw redirect({ to: '/login' });
    if (!hasOnboarded()) throw redirect({ to: '/onboarding' });
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <AppQueryProvider>
      <MfaProvider>
        <AuthProvider>
          <DataProvider>
            <ToastProvider>
              <DashboardShell>
                <Outlet />
              </DashboardShell>
            </ToastProvider>
          </DataProvider>
        </AuthProvider>
      </MfaProvider>
    </AppQueryProvider>
  );
}
