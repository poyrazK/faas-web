import { useState } from 'react';
import { Link, useMatchRoute } from '@tanstack/react-router';
import { NavArrowDown } from 'iconoir-react';
import { DOC_SECTIONS, findDoc } from '@/lib/docs-manifest';

function SectionList({ onNavigate }: { onNavigate?: () => void }) {
  const matchRoute = useMatchRoute();
  return (
    <div className="docs-nav-groups">
      <Link
        to="/docs"
        onClick={onNavigate}
        className="docs-nav-overview"
        activeOptions={{ exact: true }}
        activeProps={{ 'aria-current': 'page' }}
      >
        Overview
      </Link>
      {DOC_SECTIONS.map((section) => (
        <div key={section.title}>
          <h2>{section.title}</h2>
          <ul>
            {section.entries.map((entry) => {
              const active = Boolean(
                matchRoute({ to: '/docs/$slug', params: { slug: entry.slug } })
              );
              return (
                <li key={entry.slug}>
                  <Link
                    to="/docs/$slug"
                    params={{ slug: entry.slug }}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                  >
                    {entry.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function DocsSidebar() {
  return (
    <nav aria-label="Documentation" className="docs-sidebar">
      <SectionList />
    </nav>
  );
}

export function DocsMobileNav() {
  const [open, setOpen] = useState(false);
  const matchRoute = useMatchRoute();
  const match = matchRoute({ to: '/docs/$slug' });
  const current = match ? findDoc(match.slug) : undefined;
  return (
    <div className="docs-mobile-nav">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="docs-mobile-nav"
        onClick={() => setOpen(!open)}
      >
        <span>{current?.title ?? 'Browse documentation'}</span>
        <NavArrowDown aria-hidden="true" width={18} />
      </button>
      {open && (
        <nav id="docs-mobile-nav" aria-label="Documentation">
          <SectionList onNavigate={() => setOpen(false)} />
        </nav>
      )}
    </div>
  );
}
