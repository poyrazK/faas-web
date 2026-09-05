import { createFileRoute, redirect } from '@tanstack/react-router';
import { useSweepNavigate } from '@/components/sweep-link';
import { NewAppWizard } from '@/components/dashboard/new-app-wizard';
import { Button } from '@/components/ui/button';
import { PixelBeams } from '@/components/landing/shaders/pixel-beams';
import { beginOnboardingGitHubConnect, markOnboarded, readSession, useAuth } from '@/lib/auth';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/onboarding')({
  head: () => pageHead({ title: 'Get started' }),
  beforeLoad: () => {
    if (!readSession()) throw redirect({ to: '/login' });
  },
  component: OnboardingPage,
});

function OnboardingPage() {
  const sweepNavigate = useSweepNavigate();
  const { user } = useAuth();

  const finish = () => {
    markOnboarded();
  };

  const skip = () => {
    markOnboarded();
    sweepNavigate('/dashboard');
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <PixelBeams className="inset-0" intensity={0.32} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to right, rgba(251,252,251,0.28) 0%, rgba(251,252,251,0.94) 24%, rgba(251,252,251,0.94) 76%, rgba(251,252,251,0.28) 100%)',
        }}
      />

      <header className="relative flex items-center justify-between border-b border-border px-5 py-4 sm:px-8">
        <img src="/logo.png" alt="Gregale" className="h-7 w-auto" />
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={skip}>
            Skip for now
          </Button>
        </div>
      </header>

      <main className="relative px-5 py-10 sm:py-14">
        <NewAppWizard
          onboarding
          onAppCreated={finish}
          onConnectGitHub={beginOnboardingGitHubConnect}
        />
      </main>
    </div>
  );
}
