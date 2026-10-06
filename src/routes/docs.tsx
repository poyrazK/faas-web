import { createFileRoute, Link, Outlet } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { DocsSearch } from '@/components/docs/docs-search';
import { DocsMobileNav, DocsSidebar } from '@/components/docs/doc-nav';
import { pageHead } from '@/lib/seo';
import '@/components/docs/docs.css';

export const Route = createFileRoute('/docs')({
  component: DocsLayout,
  head: () => pageHead({ title: 'Documentation' }),
});

/** A docs-specific header and search, persistent navigation, and reading area. */
function DocsLayout() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="docs-header">
          <div className="docs-header-inner">
            <div className="docs-brand">
              <Link to="/" aria-label="Gregale home">
                <img src="/favicon.png" alt="" width="28" height="28" />
                <span>Gregale</span>
              </Link>
              <span aria-hidden="true">/</span>
              <Link to="/docs">Docs</Link>
            </div>
            <DocsSearch />
            <Link to="/dashboard" className="docs-console-link">
              Open console <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </header>

        <div className="docs-shell">
          <DocsMobileNav />
          <div className="docs-columns">
            <DocsSidebar />
            <main id="main" className="min-w-0 flex-1">
              <Outlet />
            </main>
          </div>
        </div>
      </div>
    </MotionConfig>
  );
}
