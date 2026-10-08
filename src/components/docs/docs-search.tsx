import { useEffect, useId, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Search, Xmark } from 'iconoir-react';
import { searchDocs } from '@/lib/docs-search';

export function DocsSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const results = searchDocs(query);
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
        onFocus={() => setOpen(true)}
        onChange={(event) => {
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
            {results.length ? `${results.length} matching guides` : 'No matching guides'}
          </p>
          {results.length ? (
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
