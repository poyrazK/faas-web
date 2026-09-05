import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { MotionConfig } from 'motion/react';
import { Nav } from '@/components/landing/nav';
import { Hero } from '@/components/landing/hero';
import { HowItWorks } from '@/components/landing/how-it-works';
import { Process } from '@/components/landing/process';
import { Why } from '@/components/landing/why';
import { Pricing } from '@/components/landing/pricing';
import { Footer } from '@/components/landing/footer';
import {
  AuthProvider,
  clearOAuthPending,
  hasOAuthPending,
  hasOnboarded,
  useAuth,
} from '@/lib/auth';
import { pageHead } from '@/lib/seo';
import { EMBLEM_AVIF_SRC_SET, EMBLEM_SIZES, emblem600Avif } from '@/assets/landing/emblem';

export const Route = createFileRoute('/')({
  component: LandingPage,
  head: () => ({
    ...pageHead(),
    links: [
      {
        rel: 'preload',
        href: '/fonts/familjen-grotesk-latin-v11.woff2',
        as: 'font',
        type: 'font/woff2',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        href: emblem600Avif,
        as: 'image',
        type: 'image/avif',
        imageSrcSet: EMBLEM_AVIF_SRC_SET,
        imageSizes: EMBLEM_SIZES,
        fetchPriority: 'high',
      },
    ],
  }),
});

function LandingPage() {
  return (
    <AuthProvider>
      <LandingContent />
    </AuthProvider>
  );
}

function LandingContent() {
  const { user, loading } = useAuth();

  // The OAuth callback redirects to WEBSITE_URL (the landing page). Once the
  // AuthProvider has exchanged the restored cookie for account data, finish
  // the handoff that email/password completes inline.
  useEffect(() => {
    if (loading || !hasOAuthPending()) return;
    clearOAuthPending();
    if (!user) return;
    window.location.replace(hasOnboarded() ? '/dashboard' : '/onboarding');
  }, [loading, user]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Nav reloadDocument />
        <main id="main">
          <Hero />
          <HowItWorks />
          <Process />
          <Why />
          <Pricing />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
