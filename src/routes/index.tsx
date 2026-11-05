import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { OAuthHandoff } from '@/components/auth/oauth-handoff';
import { MotionConfig } from 'motion/react';
import { Nav } from '@/components/landing/nav';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Process } from '@/components/landing/process';
import { FeatureExplorer } from '@/components/landing/feature-explorer';
import { PracticalQuestions } from '@/components/landing/practical-questions';
import { Pricing } from '@/components/landing/pricing';
import { Footer } from '@/components/landing/footer';
import { hasOAuthPending, useAuth } from '@/lib/auth';

export const Route = createFileRoute('/')({
  component: LandingPage,
});

function LandingPage() {
  const [returning] = useState(hasOAuthPending);
  const { sessionError } = useAuth();
  if (returning && (hasOAuthPending() || sessionError))
    return (
      <AuthLayout>
        <OAuthHandoff />
      </AuthLayout>
    );

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
          <FeatureExplorer />
          <PracticalQuestions />
          <Pricing />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
