import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { MotionConfig } from 'motion/react';
import { Nav } from '@/components/landing/nav';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Process } from '@/components/landing/process';
import { Pricing } from '@/components/landing/pricing';
import { Footer } from '@/components/landing/footer';
import { clearOAuthPending, hasOAuthPending, hasOnboarded, useAuth } from '@/lib/auth';

export const Route = createFileRoute('/')({
  component: LandingPage,
});

function LandingPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  // The OAuth callback redirects to WEBSITE_URL (the landing page). Once the
  // AuthProvider has exchanged the restored cookie for account data, finish
  // the handoff that email/password completes inline.
  useEffect(() => {
    if (loading || !hasOAuthPending()) return;
    clearOAuthPending();
    if (!user) return;
    void navigate({ to: hasOnboarded() ? '/dashboard' : '/onboarding', replace: true });
  }, [loading, navigate, user]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Nav />
        <main id="main">
          <Hero />
          <HowItWorks />
          <Process />
          <Pricing />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
