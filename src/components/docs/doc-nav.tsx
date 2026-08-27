import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useMatchRoute } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { NavArrowDown, Search, Xmark } from 'iconoir-react';
import { EASE } from '@/components/landing/reveal';
import { DOC_SECTIONS, findDoc, type DocEntry } from '@/lib/docs-manifest';
import { fuzzyMatch, highlightSegments } from '@/lib/fuzzy';

/**
 * The docs table of contents, in both of its forms: a persistent, searchable
 * sidebar on desktop and a disclosure above the content on mobile.
 *
 * The active page is marked the way the site nav marks its active section —
 * a glowing mint dot, here sitting on the list's hairline rail — so the same
 * instrument reads as "you are here" everywhere on the site.
 */

interface FilteredEntry {
  entry: DocEntry;
  /** Matched character indices in the title. Empty when the match landed on
      the summary instead, which keeps the entry findable without pretending
      the title matched. */
  indices: number[];
}

interface FilteredSection {
  title: string;
  entries: FilteredEntry[];
}

/**
 * Filters the manifest against the query, keeping manifest order rather than
 * re-sorting by score — the sidebar is a table of contents, and a reader who
 * types "run" still wants the runtimes listed in reading order.
 */
function filterSections(query: string): FilteredSection[] {
  const q = query.trim();
  if (!q) {
    return DOC_SECTIONS.map((section) => ({
      title: section.title,
      entries: section.entries.map((entry) => ({ entry, indices: [] })),
    }));
  }

  return DOC_SECTIONS.map((section) => ({
    title: section.title,
    entries: section.entries.flatMap((entry) => {
      const onTitle = fuzzyMatch(entry.title, q);
      if (onTitle) return [{ entry, indices: onTitle.indices }];
      // "wake" should find scale-to-zero even though the title never says it.
      if (fuzzyMatch(entry.summary, q)) return [{ entry, indices: [] }];
      return [];
    }),
  })).filter((section) => section.entries.length > 0);
}

function SectionList({
  sections,
  railId,
  onNavigate,
}: {
  sections: FilteredSection[];
  /** layoutId for the sliding active dot — unique per instance, so the desktop
      and mobile lists never animate into each other. */
  railId: string;
  onNavigate?: () => void;
}) {
  const matchRoute = useMatchRoute();

  return (
    <div className="flex flex-col gap-6">
      {sections.map((section) => (
        <div key={section.title}>
          <h2 className="label-mono text-muted-foreground">{section.title}</h2>
          <ul className="mt-3 flex flex-col gap-0.5 border-l border-border">
            {section.entries.map(({ entry, indices }) => {
              const active = Boolean(
                matchRoute({ to: '/docs/$slug', params: { slug: entry.slug } })
              );
              return (
                <li key={entry.slug} className="relative">
                  {active && (
                    <motion.span
                      layoutId={railId}
                      aria-hidden
                      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                      className="absolute -left-[2.5px] top-3 h-1 w-1 rounded-full bg-brand-fill shadow-[0_0_8px_0_rgba(0,206,145,0.8)]"
                    />
                  )}
                  <Link
                    to="/docs/$slug"
                    params={{ slug: entry.slug }}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`block py-1 pl-4 pr-2 text-sm transition-colors ${
                      active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {indices.length > 0
                      ? highlightSegments(entry.title, indices).map((seg, i) =>
                          seg.match ? (
                            <mark
                              key={i}
                              className="bg-transparent font-medium text-brand underline decoration-brand/40 underline-offset-2"
                            >
                              {seg.text}
                            </mark>
                          ) : (
                            <span key={i}>{seg.text}</span>
                          )
                        )
                      : entry.title}
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
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const sections = useMemo(() => filterSections(query), [query]);

  // "/" focuses the search from anywhere on the page — a docs reader's hands
  // are on the keyboard, and the input is otherwise a mouse trip away.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <nav aria-label="Documentation" className="hidden w-56 shrink-0 lg:block">
      <div className="sticky top-24 flex max-h-[calc(100vh-7rem)] flex-col gap-6 overflow-y-auto pb-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setQuery('');
                event.currentTarget.blur();
              }
            }}
            placeholder="Search guides"
            aria-label="Search guides"
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-brand/40"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Xmark className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : (
            <kbd className="label-mono pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-border px-1.5 py-0.5 text-muted-foreground">
              /
            </kbd>
          )}
        </div>

        {sections.length > 0 ? (
          <SectionList sections={sections} railId="docs-sidebar-active" />
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing matches “{query.trim()}”.{' '}
            <button
              type="button"
              onClick={() => setQuery('')}
              className="text-brand underline-offset-4 hover:underline"
            >
              Clear the search
            </button>
          </p>
        )}
      </div>
    </nav>
  );
}

/**
 * Below lg the sidebar becomes a disclosure above the content rather than a
 * drawer — fourteen links do not warrant a modal. The button doubles as a
 * breadcrumb: it names the page you are on, so the collapsed state still says
 * where you are.
 */
export function DocsMobileNav() {
  const [open, setOpen] = useState(false);
  const matchRoute = useMatchRoute();
  const match = matchRoute({ to: '/docs/$slug' });
  const current = match ? findDoc(match.slug) : undefined;

  return (
    <div className="mb-8 lg:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="docs-mobile-nav"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left outline-none transition-colors hover:border-border-secondary"
      >
        <span className="min-w-0">
          <span className="label-mono block text-brand">Documentation</span>
          <span className="mt-0.5 block truncate text-sm">
            {current?.title ?? 'Browse the guides'}
          </span>
        </span>
        <NavArrowDown
          aria-hidden
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="docs-mobile-nav"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mt-2 rounded-xl border border-border bg-card p-4">
              <SectionList
                sections={filterSections('')}
                railId="docs-mobile-active"
                onNavigate={() => setOpen(false)}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
