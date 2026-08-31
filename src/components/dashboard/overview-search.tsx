import { useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { BorderBeam } from 'border-beam';
import { GitBranch, Plus, Search, Upload } from 'iconoir-react';
import { Kbd } from '@/components/ui/kbd';
import { PointerGlow } from '@/components/amicro/pointer-glow';
import { NAV_ITEMS, type NavIcon } from './nav-config';
import { fuzzyMatch, highlightSegments } from '@/lib/fuzzy';
import type { Workflow } from '@/lib/mock-data';
import { cn } from '@/lib/utils';

/**
 * The overview's search, answered in place.
 *
 * A real combobox: results drop down anchored to the field instead of
 * teleporting into the ⌘K modal — searching from the page stays on the
 * page. The global palette still exists everywhere (the kbd chip is
 * honest); this is the same matching over the same destinations, rooted
 * where the question was typed.
 */

interface Item {
  id: string;
  label: string;
  group: string;
  icon: NavIcon;
  go: () => void;
}

export function OverviewSearch({ workflows }: { workflows: Workflow[] }) {
  const navigate = useNavigate();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const items = useMemo<Item[]>(
    () => [
      ...workflows.map((w) => ({
        id: `app-${w.id}`,
        label: w.name,
        group: 'App',
        icon: GitBranch,
        go: () =>
          void navigate({
            to: '/dashboard/workflows/$workflowId',
            params: { workflowId: w.id },
          }),
      })),
      {
        id: 'new',
        label: 'New app',
        group: 'Action',
        icon: Plus,
        go: () => void navigate({ to: '/dashboard/workflows/new' }),
      },
      {
        id: 'templates',
        label: 'Deploy a template',
        group: 'Action',
        icon: Plus,
        go: () => void navigate({ to: '/dashboard/templates' }),
      },
      {
        id: 'import',
        label: 'Import a project',
        group: 'Action',
        icon: Upload,
        go: () => void navigate({ to: '/dashboard/import' }),
      },
      ...NAV_ITEMS.filter((n) => n.to !== '/dashboard').map((n) => ({
        id: `nav-${n.to}`,
        label: n.label,
        group: 'Page',
        icon: n.icon,
        go: () => void navigate({ to: n.to }),
      })),
    ],
    [workflows, navigate]
  );

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) {
      // Focused but empty: the likeliest destinations, not a wall of pages.
      return items.slice(0, 7).map((item) => ({ item, indices: [] as number[] }));
    }
    return items
      .map((item) => {
        const m = fuzzyMatch(item.label, q);
        return m ? { item, indices: m.indices, score: m.score } : null;
      })
      .filter((r): r is { item: Item; indices: number[]; score: number } => r !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 9);
  }, [items, query]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };

  const pick = (item: Item) => {
    close();
    inputRef.current?.blur();
    item.go();
  };

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node | null)) close();
      }}
    >
      <BorderBeam
        size="md"
        colorVariant="ocean"
        theme="dark"
        strength={1}
        hueRange={10}
        className="w-full"
        style={{ ['--beam-hue-base' as string]: '-78deg' }}
      >
        {/* The whole field is a click target for the input — padding and
            icon included, like a real search box. */}
        <div
          onMouseDown={(e) => {
            if (e.target !== inputRef.current) {
              e.preventDefault();
              inputRef.current?.focus();
            }
          }}
          className="glass relative flex h-11 w-full cursor-text items-center gap-3 overflow-hidden rounded-xl border border-border px-4 shadow-elevation-1 focus-within:border-border-secondary"
        >
          <PointerGlow />
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                close();
                inputRef.current?.blur();
              }
              if (!open) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((i) => (results.length ? (i + 1) % results.length : 0));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                const r = results[active];
                if (r) pick(r.item);
              }
            }}
            placeholder="Search apps, pages, and actions…"
            aria-label="Search apps, pages, and actions"
            role="combobox"
            aria-expanded={open && results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && results[active] ? `ovs-${active}` : undefined}
            className="h-full flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <Kbd className="ml-auto shrink-0 px-1.5">⌘K</Kbd>
        </div>
      </BorderBeam>

      {open && (
        // The same mint beam as the field, so the pair reads as one
        // instrument — but at a crawl: the list is where reading happens,
        // and a fast orbit around prose is a distraction, not a light.
        <BorderBeam
          size="md"
          colorVariant="ocean"
          theme="dark"
          strength={1}
          hueRange={10}
          duration={7}
          className="absolute inset-x-0 top-full z-30 mt-2"
          style={{ ['--beam-hue-base' as string]: '-78deg' }}
        >
          <ul
            id={listId}
            role="listbox"
            aria-label="Search results"
            className="animate-pop-in max-h-80 w-full overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-elevation-3"
          >
            {results.length === 0 ? (
              <li className="px-2.5 py-3 text-sm text-muted-foreground">
                No matches for “{query}”.
              </li>
            ) : (
              results.map(({ item, indices }, i) => {
                const Icon = item.icon;
                return (
                  <li
                    key={item.id}
                    id={`ovs-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    // Mousedown, so the pick lands before the input's blur closes
                    // the list out from under the click.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(item);
                    }}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                      i === active ? 'bg-muted text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="flex-1 truncate">
                      {highlightSegments(item.label, indices).map((seg, si) =>
                        seg.match ? (
                          <mark
                            key={si}
                            className="bg-transparent font-medium text-brand underline decoration-brand/40 underline-offset-2"
                          >
                            {seg.text}
                          </mark>
                        ) : (
                          <span key={si}>{seg.text}</span>
                        )
                      )}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground/70">{item.group}</span>
                  </li>
                );
              })
            )}
          </ul>
        </BorderBeam>
      )}
    </div>
  );
}
