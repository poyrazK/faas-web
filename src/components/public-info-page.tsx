import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { Nav } from '@/components/landing/nav';

export function PublicInfoPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Nav />
        <main id="main" className="mx-auto max-w-3xl px-5 pb-24 pt-28 sm:px-8 sm:pt-36">
          <p className="label-mono text-brand">{eyebrow}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">{title}</h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground">{intro}</p>
          <div className="mt-12 space-y-10 border-t border-border pt-10 text-sm leading-7 [&_a]:text-brand [&_a]:underline-offset-4 [&_a:hover]:underline [&_h2]:mb-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_p+p]:mt-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
            {children}
          </div>
        </main>
        <footer className="border-t border-border px-5 py-8 text-sm text-muted-foreground sm:px-8">
          <nav
            aria-label="Policies and support"
            className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-2"
          >
            <Link to="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link to="/support" className="hover:text-foreground">
              Support
            </Link>
          </nav>
        </footer>
      </div>
    </MotionConfig>
  );
}
