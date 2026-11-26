import { createFileRoute, Outlet } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { Nav } from '@/components/landing/nav';
import { Footer } from '@/components/landing/footer';

export const Route = createFileRoute('/solutions')({
  component: SolutionsLayout,
});

function SolutionsLayout() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Nav />
        <main id="main" className="mx-auto max-w-5xl px-4 pb-24 pt-32 sm:px-6 lg:pt-40">
          <Outlet />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  );
}
