import { useEffect, useId, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Search, Xmark } from 'iconoir-react';
import type { searchDocs as SearchDocs } from '@/lib/docs-search';

/**
 * The search index holds every docs page (~900 KB of markdown), and this box
 * is on every docs page. It loads on first focus or keystroke, so reading one
 * page downloads that page and not the corpus.
 */
let searchModule: Promise<typeof SearchDocs> | undefined;
function loadSearch() {
  searchModule ??= import('@/lib/docs-search').then((module) => module.searchDocs);
  return searchModule;
}

export function DocsSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState<typeof SearchDocs | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const results = search ? search(query) : [];
  const prepare = () => {
    if (!search) void loadSearch().then((fn) => setSearch(() => fn));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('input,textarea,select,[contenteditable]')
      )
        return;
      if (
        event.key === '/' ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
      ) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div
      className="docs-search"
      role="search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          input.current?.focus();
          setOpen(false);
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const links = Array.from(
            resultsRef.current?.querySelectorAll<HTMLAnchorElement>('a') ?? []
          );
          if (!links.length) return;
          event.preventDefault();
          const current = links.indexOf(document.activeElement as HTMLAnchorElement);
          const next =
            current < 0
              ? event.key === 'ArrowDown'
                ? 0
                : links.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
          links[next]?.focus();
        }
      }}
    >
      <Search aria-hidden="true" width={18} />
      <input
        ref={input}
        type="search"
        aria-label="Search documentation"
        placeholder="Search guides, commands, errors…"
        value={query}
        onFocus={() => {
          prepare();
          setOpen(true);
        }}
        onChange={(event) => {
          prepare();
          setQuery(event.target.value);
          setOpen(true);
        }}
        aria-controls={open && query.trim() ? id : undefined}
      />
      {query ? (
        <button
          type="button"
          aria-label="Clear documentation search"
          onClick={() => {
            setQuery('');
            input.current?.focus();
          }}
        >
          <Xmark width={16} aria-hidden="true" />
        </button>
      ) : (
        <kbd aria-hidden="true">/</kbd>
      )}
      {open && query.trim() && (
        <div id={id} ref={resultsRef} className="docs-search-results">
          <p role="status">
            {!search
              ? 'Loading search…'
              : results.length
                ? `${results.length} matching guides`
                : 'No matching guides'}
          </p>
          {!search ? null : results.length ? (
            <ul>
              {results.map(({ entry, section, excerpt }) => (
                <li key={entry.slug}>
                  <Link
                    to="/docs/$slug"
                    params={{ slug: entry.slug }}
                    onClick={() => {
                      setOpen(false);
                      setQuery('');
                    }}
                  >
                    <small>{section}</small>
                    <strong>{entry.title}</strong>
                    <span>{excerpt}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="docs-search-empty">
              Try a topic such as “deploy”, an error code, or a command such as “gregale login”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
