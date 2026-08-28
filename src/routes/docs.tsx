import { createFileRoute, Outlet } from '@tanstack/react-router';
import { MotionConfig } from 'motion/react';
import { Nav } from '@/components/landing/nav';
import { DocsMobileNav, DocsSidebar } from '@/components/docs/doc-nav';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/docs')({
  component: DocsLayout,
  head: () => pageHead({ title: 'Documentation' }),
});

/**
 * The docs shell: site nav, a persistent section sidebar, and the page.
 *
 * The sidebar is the whole table of contents rather than the current section
 * only — the set is small enough to show at once, and seeing the shape of the
 * documentation is most of what an index is for. Below lg it collapses into a
 * disclosure above the content rather than a drawer — fourteen links do not
 * warrant a modal.
 *
 * No footer here. The landing footer is a tall conversion panel with a dither
 * shader; under a reference page it buries the content and costs a canvas on
 * every doc view.
 */
function DocsLayout() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <Nav />

        {/* pt clears the fixed nav capsule (68px tall) with breathing room,
            so the page header never starts underneath it. */}
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-24 sm:px-6 lg:pt-28">
          <DocsMobileNav />
          <div className="flex gap-10">
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
