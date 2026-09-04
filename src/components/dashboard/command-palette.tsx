import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { UTurnArrowLeft, GitBranch, LogOut, Plus, Search, SidebarCollapse } from 'iconoir-react';
import { APP_TABS, NAV_ITEMS, SECTION_LABELS, type NavIcon } from './nav-config';
import { EASE } from './motion';
import { Kbd } from '@/components/ui/kbd';
import { useData } from '@/lib/store';
import { formatCompact } from '@/lib/mock-data';
import { cn } from '@/lib/utils';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { fuzzyMatch, highlightSegments } from '@/lib/fuzzy';

/**
 * ⌘K command palette. Navigation, every function by name, and the actions
 * that were previously only reachable by hunting through pages.
 */

interface Command {
  id: string;
  label: string;
  group: string;
  hint?: string;
  icon: NavIcon;
  run: () => void;
}

/** A command plus where the query matched its label, for highlighting. */
interface Result {
  command: Command;
  indices: number[];
}

/* The palette remembers what it ran. Recency is the best signal a launcher
 * has, so the last few commands surface first when it opens empty-handed. */
const RECENT_KEY = 'gregale.palette.recent';
const RECENT_MAX = 5;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function recordRecent(id: string) {
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage can be denied; the palette works fine without a memory.
  }
}

export function CommandPalette({
  open,
  onOpenChange,
  onSignOut,
  onToggleSidebar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shell actions surfaced as commands — the palette is how you reach a
   * thing you know the name of, and that includes leaving. */
  onSignOut?: () => void;
  onToggleSidebar?: () => void;
}) {
  const navigate = useNavigate();
  const { workflows } = useData();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useFocusTrap(dialogRef, open);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => {
      close();
      navigate({ to });
    };

    return [
      // Driven by the nav config, so a new page becomes reachable by ⌘K the
      // moment it appears in the sidebar.
      ...NAV_ITEMS.map((item) => ({
        id: `nav-${item.to}`,
        label: item.label,
        group: 'Go to',
        icon: item.icon,
        run: go(item.to),
      })),
      // The per-app resources left the sidebar for the app's own tabs, but
      // they are still whole pages with a picker, and ⌘K is how you reach a
      // page you know the name of.
      ...APP_TABS.map((t) => ({
        id: `nav-app-${t.segment}`,
        label: SECTION_LABELS[t.segment] ?? t.tab,
        group: 'Go to',
        icon: Search,
        run: go(`/dashboard/${t.segment}`),
      })),
      {
        id: 'act-new',
        label: 'New app',
        group: 'Actions',
        icon: Plus,
        run: go('/dashboard/workflows/new'),
      },
      {
        id: 'act-template',
        label: 'Deploy a template',
        group: 'Actions',
        icon: Plus,
        run: go('/dashboard/templates'),
      },
      {
        id: 'act-docs',
        label: 'Documentation',
        group: 'Actions',
        icon: Search,
        run: go('/docs'),
      },
      ...(onToggleSidebar
        ? [
            {
              id: 'act-sidebar',
              label: 'Toggle sidebar',
              group: 'Actions',
              icon: SidebarCollapse,
              run: () => {
                close();
                onToggleSidebar();
              },
            },
          ]
        : []),
      ...(onSignOut
        ? [
            {
              id: 'act-signout',
              label: 'Sign out',
              group: 'Actions',
              icon: LogOut,
              run: () => {
                close();
                onSignOut();
              },
            },
          ]
        : []),
      ...workflows.map((fn) => ({
        id: fn.id,
        label: fn.name,
        group: 'Workflows',
        hint: `${formatCompact(fn.invocations24h)} calls · ${fn.runtime}`,
        icon: GitBranch,
        run: () => {
          close();
          navigate({
            to: '/dashboard/workflows/$workflowId',
            params: { workflowId: fn.id },
          });
        },
      })),
      // Verbs, not just nouns: the two per-app destinations an operator
      // reaches for mid-incident, addressable as "logs api-gateway". After
      // the plain app rows so an app search still leads with the app.
      ...workflows.flatMap((fn) =>
        (
          [
            { tab: 'Logs', verb: 'Tail logs' },
            { tab: 'Configuration', verb: 'Configure' },
          ] as const
        ).map(({ tab, verb }) => ({
          id: `act-${tab.toLowerCase()}-${fn.id}`,
          label: `${verb} — ${fn.name}`,
          group: 'App actions',
          icon: GitBranch,
          run: () => {
            close();
            navigate({
              to: '/dashboard/workflows/$workflowId',
              params: { workflowId: fn.id },
              search: { tab },
            });
          },
        }))
      ),
    ];
  }, [workflows, navigate, close, onSignOut, onToggleSidebar]);

  // Ranked results, or — when the palette opens empty-handed — the recent
  // commands lifted into their own leading group.
  const withRecent = useMemo<Command[]>(() => {
    if (!open) return commands;
    const recent = readRecent();
    if (recent.length === 0) return commands;
    const byId = new Map(commands.map((c) => [c.id, c]));
    const recentCmds = recent
      .map((id) => byId.get(id))
      .filter((c): c is Command => Boolean(c))
      .map((c) => ({ ...c, group: 'Recent' }));
    return [...recentCmds, ...commands];
  }, [commands, open]);

  const results = useMemo<Result[]>(() => {
    const q = query.trim();
    if (!q) return withRecent.map((command) => ({ command, indices: [] }));

    return (
      commands
        .map((command) => {
          // The label is what the user is aiming at, so only its match drives
          // highlighting. Group and hint still *find* a command — searching
          // "workflows" should surface them all — but at a discount, so a
          // label hit always outranks an incidental group hit.
          const onLabel = fuzzyMatch(command.label, q);
          const onGroup = fuzzyMatch(command.group, q);
          const onHint = command.hint ? fuzzyMatch(command.hint, q) : null;

          const best = Math.max(
            onLabel?.score ?? -Infinity,
            (onGroup?.score ?? -Infinity) - 20,
            (onHint?.score ?? -Infinity) - 30
          );
          if (best === -Infinity) return null;

          return { command, indices: onLabel?.indices ?? [], score: best };
        })
        .filter((r): r is Result & { score: number } => r !== null)
        // Stable within a score, so equally-good matches keep the source
        // order that groups them ("Go to", then "Actions", then workflows).
        .sort((a, b) => b.score - a.score)
    );
  }, [commands, withRecent, query]);

  // Keep the highlight in range as the result set shrinks.
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus after paint, or the input is not yet mounted. (The trap restores
    // focus to the opener on close.)
    const id = requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = previousOverflow;
      setQuery('');
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    // Escape can originate on the opener while the palette is mounting, so an
    // element handler would never see it. Only the topmost dialog may claim
    // the key; a Modal rendered above the palette keeps its own dismissal.
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      e.preventDefault();
      close();
    };

    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [open, close]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
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
      const cmd = results[active]?.command;
      if (cmd) {
        recordRecent(cmd.id);
        cmd.run();
      }
    }
    // Long result lists are faster to cross end-to-end than by arrow-holding.
    if (e.key === 'Home') {
      e.preventDefault();
      setActive(0);
    }
    if (e.key === 'End') {
      e.preventDefault();
      setActive(Math.max(0, results.length - 1));
    }
  };

  // Group headers only make sense in source order. Once a query ranks results
  // by score they interleave, so searching drops the headers entirely rather
  // than repeating "Workflows" every third row.
  const grouped = query.trim() === '';
  let lastGroup = '';

  // The dialog mounts the instant `open` flips (so the focus trap and the
  // input focus find it) and lingers only for its short exit.
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center p-4 pt-[12vh]">
          <motion.button
            aria-label="Close command palette"
            tabIndex={-1}
            onClick={close}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.12 } }}
            transition={{ duration: reduce ? 0 : 0.15 }}
            className="absolute inset-0 bg-mint-12/50 backdrop-blur-sm"
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            onKeyDown={onKeyDown}
            initial={reduce ? false : { opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              reduce
                ? { opacity: 0, transition: { duration: 0 } }
                : {
                    opacity: 0,
                    scale: 0.98,
                    y: -6,
                    transition: { duration: 0.12, ease: EASE },
                  }
            }
            transition={{ duration: reduce ? 0 : 0.18, ease: EASE }}
            className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-elevation-3"
          >
            <div className="flex items-center gap-2.5 border-b border-border px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search workflows, jump to a page, run an action…"
                aria-label="Search commands"
                role="combobox"
                aria-expanded={results.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={results[active] ? `cmd-${active}` : undefined}
                className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <Kbd>esc</Kbd>
            </div>

            {results.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">No matches for “{query}”.</p>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    navigate({ to: '/dashboard/workflows/new' });
                  }}
                  className="pressable inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-border-secondary hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                  Create a new app instead
                </button>
              </div>
            ) : (
              <ul
                ref={listRef}
                id={listId}
                role="listbox"
                aria-label="Results"
                className="max-h-80 overflow-y-auto p-2"
              >
                {results.map(({ command: cmd, indices }, i) => {
                  const Icon = cmd.icon;
                  const newGroup = grouped && cmd.group !== lastGroup;
                  lastGroup = cmd.group;
                  return [
                    newGroup && (
                      <li
                        key={`group-${cmd.group}`}
                        role="presentation"
                        className="label-mono px-2 pb-1.5 pt-3 text-muted-foreground/70 first:pt-1"
                      >
                        {cmd.group}
                      </li>
                    ),
                    <li
                      key={`${cmd.group}-${cmd.id}`}
                      id={`cmd-${i}`}
                      role="option"
                      aria-selected={i === active}
                      data-active={i === active}
                      onMouseMove={() => setActive(i)}
                      onClick={() => {
                        recordRecent(cmd.id);
                        cmd.run();
                      }}
                      className={cn(
                        'relative isolate flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors',
                        i === active
                          ? cn('text-foreground', reduce && 'bg-muted')
                          : 'text-muted-foreground'
                      )}
                    >
                      {/* One highlight slides between options rather than each
                      row lighting up on its own. */}
                      {i === active && !reduce && (
                        <motion.span
                          aria-hidden="true"
                          layoutId="palette-active"
                          className="absolute inset-0 -z-10 rounded-md bg-muted"
                          transition={{
                            type: 'spring',
                            stiffness: 500,
                            damping: 40,
                          }}
                        />
                      )}
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex-1 truncate">
                        {highlightSegments(cmd.label, indices).map((seg, si) =>
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
                      {/* Searching drops the group headers, so each row has to
                          say where it came from on its own. */}
                      {!grouped && !cmd.hint && (
                        <span className="shrink-0 text-xs text-muted-foreground/70">
                          {cmd.group}
                        </span>
                      )}
                      {cmd.hint && (
                        <span className="shrink-0 text-xs text-muted-foreground">{cmd.hint}</span>
                      )}
                      {i === active && <UTurnArrowLeft className="h-3 w-3 shrink-0" />}
                    </li>,
                  ];
                })}
              </ul>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
