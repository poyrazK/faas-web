import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  IconoirProvider,
  CloudXmark,
  LogOut,
  Menu,
  NavArrowDown,
  Plus,
  Search,
  SidebarCollapse,
  SidebarExpand,
  Settings,
  Xmark,
} from 'iconoir-react';
import { useData } from '@/lib/store';
import { readWorkspace, useAuth } from '@/lib/auth';
import { useSweepNavigate } from '@/components/sweep-link';
import { useToast } from '@/components/ui/toast';
import { ConfirmProvider } from '@/components/ui/confirm';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { NewAppButton } from './new-app-button';
import { CommandPalette } from './command-palette';
import { EASE } from './motion';
import {
  findNavHub,
  isDisclosureHub,
  matchesNavPath,
  NAV_GROUPS,
  type NavHub,
  type NavItem,
  SECTION_LABELS,
  sidebarSectionsFor,
} from './nav-config';
import { DashboardSecondaryNavigation } from './secondary-navigation';
import { recordVisit } from '@/lib/recents';
import { cn } from '@/lib/utils';
import { useFocusTrap } from '@/lib/use-focus-trap';

const COLLAPSE_KEY = 'gregale.sidebar.collapsed';
const OPEN_GROUPS_KEY = 'gregale.sidebar.closedGroups';

/**
 * Which disclosures the reader has shut.
 *
 * Stored as the closed set, not the open one, so open stays the default even
 * after a hub is added — an unknown hub is open because nobody has closed it.
 */
function readClosedGroups(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(OPEN_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function readCollapsed(): boolean {
  // Expanded is the default, and collapsing (⌘B) is the stored exception.
  //
  // It was the other way round, which worked when the rail was a flat list of
  // twenty-six icons: dense enough to aim at, and the labels were a hover away.
  // Against hubs-plus-sections it stops working — the second level cannot fit
  // in 40px, so the default state became ten unlabelled glyphs and a long
  // emptiness under them, and every destination cost a hover before it could
  // even be read. A console this wide is scanned far more often than it is
  // aimed at; the rail should answer "what is here" without being asked.
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(COLLAPSE_KEY) === '1';
}

/**
 * One navigable row of the rail, at either level.
 *
 * Hub and section share an implementation so they can never drift in padding,
 * focus ring or active treatment — only indent, weight and colour separate
 * them, which is exactly the difference a reader should see.
 */
function NavRow({
  item,
  nested = false,
  collapsed = false,
  labelCls,
  reduce,
  onNavigate,
  pathname,
  hash,
  current,
}: {
  item: NavItem;
  nested?: boolean;
  collapsed?: boolean;
  labelCls: string;
  reduce: boolean | null;
  onNavigate?: () => void;
  pathname: string;
  hash: string;
  current: boolean;
}) {
  const { to, label, icon: Icon, exact } = item;
  const onThisPath = matchesNavPath(pathname, { to, exact: true });
  const link = (
    <Link
      to={to}
      search={onThisPath ? true : undefined}
      hash={onThisPath ? hash : undefined}
      activeOptions={{ exact: exact ?? false, includeSearch: false }}
      onClick={onNavigate}
      // Collapsed, the label span is opacity-0 — the accessible name must
      // survive on the link itself, and the visual label moves into a tooltip
      // (title="" is mouse-only).
      aria-label={collapsed ? label : undefined}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'pressable relative isolate flex items-center rounded-md py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        // The nested row trades its icon for indent: a second column of glyphs
        // reads as ten more destinations rather than as detail under one.
        nested ? 'gap-2.5 py-1 pl-7 pr-2.5' : 'gap-2.5 px-2.5',
        'text-muted-foreground hover:bg-muted hover:text-foreground',
        current && '!text-foreground',
        current && reduce && 'bg-muted'
      )}
    >
      <>
        {current && !reduce && (
          <motion.span
            aria-hidden="true"
            layoutId="sidebar-active"
            className="absolute inset-0 -z-10 rounded-md bg-muted"
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          />
        )}
        {!nested && <Icon className="h-4 w-4 shrink-0" />}
        <span aria-hidden={collapsed} className={labelCls}>
          {label}
        </span>
      </>
    </Link>
  );
  // Keep the same link mounted while focus expands the rail.
  return nested ? (
    link
  ) : (
    <Tooltip content={label} side="right">
      {link}
    </Tooltip>
  );
}

/**
 * A hub that owns sections is a disclosure, not a destination.
 *
 * Its landing page rides along as the group's first child ("Overview"), which
 * is what lets the parent be a button: two links to one URL would be two
 * `aria-current="page"` rows, because the router spreads that attribute onto
 * every active link last and unconditionally.
 */
function NavDisclosure({
  hub,
  open,
  onToggle,
  onBranch,
  collapsed,
  labelCls,
  children,
}: {
  hub: NavHub;
  open: boolean;
  onToggle: () => void;
  onBranch: boolean;
  collapsed: boolean;
  labelCls: string;
  children: ReactNode;
}) {
  const Icon = hub.icon;
  const panelId = `nav-${hub.to.replace(/\W+/g, '-')}`;
  return (
    <>
      <Tooltip content={hub.label} side="right">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          aria-label={collapsed ? hub.label : undefined}
          className={cn(
            'pressable flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            'text-muted-foreground hover:bg-muted hover:text-foreground',
            onBranch && 'text-foreground'
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span aria-hidden={collapsed} className={labelCls}>
            {hub.label}
          </span>
          <NavArrowDown
            aria-hidden="true"
            className={cn(
              'ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200 ease-console',
              labelCls,
              open ? 'rotate-0' : '-rotate-90'
            )}
          />
        </button>
      </Tooltip>
      {open && (
        // The guide line is one rule down the whole group, not a tick per row:
        // it is what makes five indented labels read as one branch instead of
        // five loose entries.
        <ul
          id={panelId}
          className="relative ml-[18px] flex flex-col gap-0.5 border-l border-border pl-0"
        >
          {children}
        </ul>
      )}
    </>
  );
}

function SidebarBody({
  id,
  onNavigate,
  onOpenSearch,
  collapsed = false,
}: {
  /** Opens the command palette; the rail's search field is its front door. */
  onOpenSearch?: () => void;
  /** Namespaces the shared active pill — the desktop rail and the mobile
   * drawer each get their own, so one never tries to fly to the other. */
  id: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const reduce = useReducedMotion();
  const { pathname, hash } = useRouterState({ select: (s) => s.location });
  const currentHub = findNavHub(pathname);
  const [closedGroups, setClosedGroups] = useState<string[]>(readClosedGroups);
  const toggleGroup = useCallback((key: string) => {
    setClosedGroups((previous) => {
      const next = previous.includes(key)
        ? previous.filter((entry) => entry !== key)
        : [...previous, key];
      try {
        window.localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable — the rail still opens and shuts for this visit.
      }
      return next;
    });
  }, []);
  // Everything below shares one rule: geometry is constant between the two
  // widths. Icons never change alignment, headings never unmount, rows never
  // re-pad — only the rail's width moves, and text fades in place. That is
  // what makes the hover expansion read as one motion instead of a pop.
  const labelCls = cn(
    'truncate whitespace-nowrap transition-opacity ease-console',
    collapsed ? 'opacity-0 duration-100' : 'opacity-100 delay-75 duration-200'
  );
  return (
    <LayoutGroup id={id}>
      <Link
        to="/"
        className="relative flex h-9 items-center overflow-hidden px-2.5 py-1"
        aria-label="Gregale home"
      >
        {/* Mint recolours of the wordmark: the brand green vanishes on the
            console's near-black, so the dark surface gets its own step.
            Both renditions stay mounted, anchored to the same left edge, and
            crossfade — an image swap reads as a blink, a crossfade as the
            wordmark condensing into its mark. */}
        <img
          src="/mark-on-dark.png"
          alt=""
          className={cn(
            'absolute h-7 w-7 transition-opacity ease-console',
            collapsed ? 'opacity-100 delay-75 duration-200' : 'opacity-0 duration-100'
          )}
        />
        <img
          src="/logo-on-dark.png"
          alt=""
          className={cn('absolute h-7 w-auto max-w-none transition-opacity ease-console', labelCls)}
        />
      </Link>

      {/* The rail's own way in. The palette is the real search, so this is a
          button wearing a field's clothes rather than a second input to
          maintain — and it puts the shortcut where someone looking for search
          will actually look. */}
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="Quick search"
        className="pressable mt-4 flex h-8 w-full items-center gap-2.5 overflow-hidden rounded-md border border-border px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
        <span aria-hidden={collapsed} className={labelCls}>
          Quick search
        </span>
        <kbd
          aria-hidden="true"
          className={cn('ml-auto font-mono text-[11px] text-muted-foreground/70', labelCls)}
        >
          ⌘K
        </kbd>
      </button>

      {/* scrollbar-none: at 40px-wide rows a native scrollbar eats the rail
          and shoves the icons off-center (it did). */}
      <nav
        aria-label="Main"
        className="scrollbar-none mt-4 flex flex-col gap-4 overflow-x-hidden overflow-y-auto"
      >
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.title ?? `group-${gi}`}>
            {/* One fixed-height slot per group header, whichever face it
                wears — the heading when wide, a hairline when narrow — so
                the rows below never shift vertically during the change. */}
            {group.title && (
              <div className="relative h-6">
                <p
                  className={cn(
                    'label-mono absolute bottom-1 left-2.5 text-muted-foreground/70',
                    labelCls
                  )}
                >
                  {group.title}
                </p>
                <div
                  aria-hidden
                  className={cn(
                    'absolute inset-x-1 top-2.5 h-px bg-border transition-opacity ease-console',
                    collapsed ? 'opacity-100 delay-75 duration-200' : 'opacity-0 duration-100'
                  )}
                />
              </div>
            )}

            <ul className="flex flex-col gap-0.5">
              {group.items.map((hub) => {
                // Collapsed, the rail is 40px of icons — there is no room for a
                // second level, and the hub tooltip is the whole affordance.
                const disclosure = !collapsed && isDisclosureHub(hub);
                const onBranch = currentHub?.to === hub.to;
                if (!disclosure) {
                  return (
                    <li key={hub.to}>
                      <NavRow
                        item={hub}
                        collapsed={collapsed}
                        labelCls={labelCls}
                        reduce={reduce}
                        onNavigate={onNavigate}
                        pathname={pathname}
                        hash={hash}
                        current={onBranch}
                      />
                    </li>
                  );
                }
                const sections = sidebarSectionsFor(hub);
                // Open unless shut: a hub nobody has closed is a hub whose
                // contents should be readable without being asked for.
                const open = !closedGroups.includes(hub.to);
                return (
                  <li key={hub.to}>
                    <NavDisclosure
                      hub={hub}
                      open={open}
                      onToggle={() => toggleGroup(hub.to)}
                      onBranch={onBranch}
                      collapsed={collapsed}
                      labelCls={labelCls}
                    >
                      {sections.map((section) => (
                        <li key={`${section.to}-${section.label}`}>
                          <NavRow
                            item={section}
                            nested
                            collapsed={collapsed}
                            labelCls={labelCls}
                            reduce={reduce}
                            onNavigate={onNavigate}
                            pathname={pathname}
                            hash={hash}
                            current={matchesNavPath(pathname, section)}
                          />
                        </li>
                      ))}
                    </NavDisclosure>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </LayoutGroup>
  );
}

// Section labels come from the nav config, so a renamed nav item cannot
// drift out of sync with the breadcrumb.

/**
 * Keep the workspace/path voice while linking back to the owning hub.
 */
function Breadcrumbs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { workflows } = useData();
  const workspace = readWorkspace();

  const segments = pathname
    .replace(/^\/dashboard\/?/, '')
    .split('/')
    .filter(Boolean);
  const [section, detail] = segments;
  const hub = findNavHub(pathname);
  const pageLabel = section ? (SECTION_LABELS[section] ?? section) : 'Overview';
  const trail: { label: string; to?: string }[] = [];
  if (hub && (hub.label !== pageLabel || detail)) {
    trail.push({ label: hub.label, to: hub.to });
  }
  if (!(section === 'workflows' && detail)) trail.push({ label: pageLabel });
  if (section === 'workflows' && detail) {
    trail.push({
      label: detail === 'new' ? 'New app' : (workflows.find((w) => w.id === detail)?.name ?? 'App'),
    });
  }

  const workspaceIdentity = (
    <>
      <span className="flex h-5 w-5 items-center justify-center rounded bg-brand/20 text-[9px] font-semibold uppercase text-brand">
        {workspace.charAt(0)}
      </span>
      <span className="hidden text-muted-foreground sm:inline">{workspace}</span>
    </>
  );

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1.5 font-mono text-xs [font-variant-numeric:tabular-nums]"
    >
      {section ? (
        <Link
          to="/dashboard"
          activeOptions={{ exact: true }}
          className="pressable flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
        >
          {workspaceIdentity}
        </Link>
      ) : (
        <span className="flex shrink-0 items-center gap-2 px-1.5 py-1">{workspaceIdentity}</span>
      )}

      {trail.map(({ label, to }, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="shrink-0 text-muted-foreground/40">
              /
            </span>
            {to && !last && !matchesNavPath(pathname, { to, exact: true }) ? (
              <Link
                to={to}
                activeOptions={{ exact: true }}
                className="pressable truncate rounded-md px-1 py-1 lowercase text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {label}
              </Link>
            ) : (
              <span
                aria-current={last ? 'page' : undefined}
                className={cn(
                  'truncate lowercase',
                  last ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/**
 * Account control — identity and sign-out belong together, in one place.
 * A real Radix menu: the previous hand-rolled version declared `role="menu"`
 * but had no arrow-key model, no focus move, and no focus restore.
 */
function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const { user } = useAuth();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="account-shine inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-card text-[11px] font-medium text-foreground outline-none transition-colors duration-150 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[state=open]:bg-muted sm:size-9"
      >
        <span aria-hidden="true">{user?.initials ?? 'GG'}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={10}
        collisionPadding={12}
        className="account-shine w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border-transparent p-1.5"
      >
        <DropdownMenuLabel className="px-2.5 py-2.5">
          <p className="truncate text-sm font-medium text-foreground">{user?.name}</p>
          <p className="mt-0.5 truncate text-xs font-normal text-muted-foreground">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="mx-2.5 my-1" />
        <DropdownMenuItem asChild className="min-h-11 rounded-lg sm:min-h-10">
          <Link to="/dashboard/settings">
            <Settings aria-hidden="true" className="size-4" />
            Workspace settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={onSignOut}
          className="min-h-11 rounded-lg data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive sm:min-h-10"
        >
          <LogOut aria-hidden="true" className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One outage, said once.
 *
 * Without this every panel on the page reports the same unreachable API
 * separately, which reads as many independent failures instead of one.
 */
function UnreachableBanner() {
  const { apiReachable, refreshAccount } = useAuth();
  const [retrying, setRetrying] = useState(false);
  if (apiReachable) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm"
      style={{
        borderColor: 'color-mix(in oklab, var(--status-warning) 40%, transparent)',
        background: 'color-mix(in oklab, var(--status-warning) 8%, transparent)',
      }}
    >
      <CloudXmark className="h-4 w-4 shrink-0" style={{ color: 'var(--status-warning)' }} />
      <p className="text-foreground">
        Cannot reach the API.{' '}
        <span className="text-muted-foreground">
          Pages show what they know and nothing more — no figure here is stale.
        </span>
      </p>
      <button
        type="button"
        disabled={retrying}
        onClick={() => {
          setRetrying(true);
          void refreshAccount()
            .catch(() => {})
            .finally(() => setRetrying(false));
        }}
        className="pressable ml-auto rounded-full border border-border px-3 py-1 text-xs hover:border-border-secondary disabled:opacity-50"
      >
        {retrying ? 'Checking…' : 'Check again'}
      </button>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Persisted, so the sidebar keeps its width across navigations and reloads.
  const [collapsed, setCollapsed] = useState(readCollapsed);
  // Hovering (or keyboard focus entering) the collapsed rail expands it as
  // an overlay — the content column does not shift, so it is a peek, not a
  // relayout. Pinning it open is still ⌘B / the footer toggle. Both edges
  // carry intent delays: a cursor crossing the rail on its way somewhere
  // else should not flap it open and shut.
  const [railHovered, setRailHovered] = useState(false);
  const railCollapsed = collapsed && !railHovered;
  const railTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearRailTimer = () => clearTimeout(railTimer.current);
  const enterRail = () => {
    clearRailTimer();
    railTimer.current = setTimeout(() => setRailHovered(true), 70);
  };
  const leaveRail = () => {
    clearRailTimer();
    railTimer.current = setTimeout(() => setRailHovered(false), 240);
  };
  useEffect(() => clearRailTimer, []);
  const drawerRef = useRef<HTMLElement>(null);
  useFocusTrap(drawerRef, mobileOpen);
  const reduce = useReducedMotion();

  const toggleCollapsed = () => setCollapsed((v) => !v);
  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);
  const { signOut } = useAuth();
  const { toast } = useToast();
  const sweepNavigate = useSweepNavigate();
  const navigate = useNavigate();

  // ⌘K / Ctrl+K anywhere in the dashboard; ⌘B toggles the rail, the same
  // binding editors use; Escape closes the mobile drawer. `g` then a letter
  // jumps between sections, vi-style — the CLI-first crowd's home turf.
  const chordArm = useRef(0);
  useEffect(() => {
    // The g-chord map: g then one of these. Kept beside the handler so a new
    // section is one line away from a shortcut.
    const CHORDS = {
      o: '/dashboard',
      a: '/dashboard/workflows',
      t: '/dashboard/templates',
      i: '/dashboard/import',
      d: '/dashboard/deployments',
      b: '/dashboard/builds',
      c: '/dashboard/crons',
      q: '/dashboard/queues',
      l: '/dashboard/logs',
      u: '/dashboard/usage',
      k: '/dashboard/keys',
      s: '/dashboard/settings',
    } as const;
    const typingTarget = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Chords never fire while typing, with modifiers held, or under a
      // dialog — a palette or modal owns the keyboard while it is up.
      if (
        !mod &&
        !e.altKey &&
        !typingTarget(e.target) &&
        !document.querySelector('[role="dialog"][aria-modal="true"]')
      ) {
        if (chordArm.current > Date.now()) {
          chordArm.current = 0;
          const to = CHORDS[e.key.toLowerCase() as keyof typeof CHORDS];
          if (to) {
            e.preventDefault();
            void navigate({ to });
            return;
          }
        } else if (e.key.toLowerCase() === 'g') {
          chordArm.current = Date.now() + 900;
          return;
        }
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => {
          // Never open behind another dialog — a Modal already holds the
          // focus trap, and a palette underneath it would fight for the
          // keyboard. (Open palettes still close: they match the selector
          // themselves, and !v is then false.)
          if (!v && document.querySelector('[role="dialog"][aria-modal="true"]')) return v;
          return !v;
        });
      }
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setCollapsed((v) => !v);
      }
      if (e.key === 'Escape') setMobileOpen(false);
    };
    // The overview's search field opens the same palette; it reaches the
    // shell through this event so the two stay uncoupled.
    const onOpenPalette = () => {
      setPaletteOpen((v) => {
        if (!v && document.querySelector('[role="dialog"][aria-modal="true"]')) return v;
        return true;
      });
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('gregale:open-palette', onOpenPalette);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('gregale:open-palette', onOpenPalette);
    };
  }, [navigate]);

  // Every dashboard navigation lands in the overview's Recents column.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    recordVisit(pathname);
  }, [pathname]);

  // Toasts render at the root, outside this tree, so the dark palette has to
  // reach them too: mirror `console` onto <html> while the shell is mounted.
  // The same pass retunes `theme-color`, or mobile browser chrome stays the
  // marketing site's paper white above the console's charcoal canvas.
  useEffect(() => {
    document.documentElement.classList.add('console');

    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previous = meta?.content;
    if (meta) {
      meta.content = getComputedStyle(document.documentElement)
        .getPropertyValue('--background')
        .trim();
    }

    return () => {
      document.documentElement.classList.remove('console');
      if (meta && previous !== undefined) meta.content = previous;
    };
  }, []);

  // The drawer overlays the page, so the page beneath must not scroll.
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);

  const handleSignOut = () => {
    // Clears the local session synchronously; the server call settles behind
    // the navigation. See `signOut` in `lib/auth.tsx`.
    void signOut();
    toast({ kind: 'info', title: 'Signed out' });
    sweepNavigate('/login');
  };

  // `console` re-declares the colour tokens to the dark palette for everything
  // beneath it. The shell and its 21 routes are written entirely in tokens, so
  // nothing below this line knows the marketing site is now light.
  return (
    // Iconoir draws at 1.5px, which goes faint at the 14–16px the console
    // works at, on a near-black ground. Set once here rather than per icon;
    // the landing keeps the lighter default, where the sizes are larger.
    <IconoirProvider iconProps={{ strokeWidth: 1.8 }}>
      <TooltipProvider>
        <ConfirmProvider>
          <div className="console min-h-screen bg-background text-foreground">
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
            >
              Skip to content
            </a>
            {/* Desktop sidebar */}
            <aside
              onMouseEnter={enterRail}
              onMouseLeave={leaveRail}
              onFocus={() => {
                clearRailTimer();
                setRailHovered(true);
              }}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null))
                  setRailHovered(false);
              }}
              className={cn(
                // The stored width is applied before first paint (readCollapsed
                // in the state initializer), so this transition only ever runs
                // on a real hover or toggle, never on load. Horizontal padding
                // is constant across both widths — geometry that never moves
                // is what keeps the expansion smooth.
                'fixed inset-y-0 left-0 z-30 hidden flex-col overflow-hidden border-r border-border bg-card px-3 py-5 transition-[width] duration-300 ease-console lg:flex',
                railCollapsed ? 'w-16' : 'w-60',
                // Hover-expanded over pinned-collapsed content: a floating
                // peek, so it carries elevation the pinned states do not.
                collapsed && !railCollapsed && 'shadow-elevation-3'
              )}
            >
              <SidebarBody
                id="desktop"
                collapsed={railCollapsed}
                onOpenSearch={() => setPaletteOpen(true)}
              />

              {/* Identity and sign-out live in the top bar's account menu, so the
            sidebar footer holds only the collapse toggle. */}
              <div className="mt-auto overflow-hidden pt-4">
                <Tooltip
                  content={`${collapsed ? 'Pin sidebar open' : 'Collapse sidebar'} (⌘B)`}
                  side="right"
                >
                  <button
                    type="button"
                    onClick={toggleCollapsed}
                    aria-label={collapsed ? 'Pin sidebar open' : 'Collapse sidebar'}
                    aria-keyshortcuts="Meta+B Control+B"
                    className="pressable flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {collapsed ? (
                      <SidebarExpand className="h-4 w-4 shrink-0" />
                    ) : (
                      <SidebarCollapse className="h-4 w-4 shrink-0" />
                    )}
                    <span
                      className={cn(
                        'truncate whitespace-nowrap transition-opacity ease-console',
                        railCollapsed
                          ? 'opacity-0 duration-100'
                          : 'opacity-100 delay-75 duration-200'
                      )}
                    >
                      {collapsed ? 'Pin open' : 'Collapse'}
                    </span>
                  </button>
                </Tooltip>
              </div>
            </aside>

            {/* Mobile drawer. The palette, the modal, and the toasts all move —
              the drawer matching them is what makes the chrome feel like one
              surface. Backdrop fades; the panel slides in from the edge it
              belongs to, or cross-fades under reduced motion. */}
            <AnimatePresence>
              {mobileOpen && (
                <motion.button
                  key="drawer-backdrop"
                  aria-hidden="true"
                  tabIndex={-1}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-50 bg-overlay/50 backdrop-blur-sm lg:hidden"
                  onClick={() => setMobileOpen(false)}
                />
              )}
              {mobileOpen && (
                <motion.aside
                  key="drawer-panel"
                  ref={drawerRef}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Navigation"
                  initial={reduce ? { opacity: 0 } : { x: '-100%' }}
                  animate={reduce ? { opacity: 1 } : { x: 0 }}
                  exit={reduce ? { opacity: 0 } : { x: '-100%' }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-border bg-card px-3 py-5 lg:hidden"
                >
                  <button
                    aria-label="Close navigation"
                    className="pressable absolute right-3 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setMobileOpen(false)}
                  >
                    <Xmark className="h-4 w-4" />
                  </button>
                  <SidebarBody
                    id="mobile"
                    onNavigate={() => setMobileOpen(false)}
                    onOpenSearch={() => setPaletteOpen(true)}
                  />
                </motion.aside>
              )}
            </AnimatePresence>

            <div
              className={cn(
                'console-atmosphere min-h-screen transition-[padding] duration-300 ease-console',
                collapsed ? 'lg:pl-16' : 'lg:pl-60'
              )}
            >
              {/* Top bar */}
              <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md sm:px-6">
                <button
                  aria-label="Open navigation"
                  className="pressable rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
                  onClick={() => setMobileOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                </button>

                <Breadcrumbs />

                <div className="ml-auto flex items-center gap-1.5">
                  <NewAppButton />
                  {/* Search lives on the overview as the page's own field;
                      ⌘K still opens the palette from anywhere. */}
                  <AccountMenu onSignOut={handleSignOut} />
                </div>
              </header>

              <main id="main" tabIndex={-1} className="px-4 py-8 outline-none sm:px-6 lg:px-8">
                {/* A measure, not the full viewport: past ~1100px a form row or a
                label/value pair stops scanning as a pair. Tables set their own
                min-width and scroll inside it. */}
                {/* Pages settle in via the CSS `animate-item-enter` entrance
                  on PageHeader, Panel, StatTile, and the table — a mount
                  animation, so it replays for every route's fresh DOM and for
                  content that arrives late (code-split chunks, post-fetch
                  panels). A pathname-keyed Stagger was tried here and left
                  exactly that late content stranded at opacity 0. */}
                <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
                  <UnreachableBanner />
                  <DashboardSecondaryNavigation />
                  {children}
                </div>
              </main>
            </div>

            <CommandPalette
              open={paletteOpen}
              onOpenChange={setPaletteOpen}
              onSignOut={handleSignOut}
              onToggleSidebar={toggleCollapsed}
            />
          </div>
        </ConfirmProvider>
      </TooltipProvider>
    </IconoirProvider>
  );
}
