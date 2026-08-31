import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  IconoirProvider,
  NavArrowDown,
  CloudXmark,
  LogOut,
  Menu,
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
import { CommandPalette } from './command-palette';
import { EASE } from './motion';
import { NAV_GROUPS, SECTION_LABELS } from './nav-config';
import { recordVisit } from '@/lib/recents';
import { cn } from '@/lib/utils';
import { useFocusTrap } from '@/lib/use-focus-trap';

const COLLAPSE_KEY = 'gregale.sidebar.collapsed';

function readCollapsed(): boolean {
  // Collapsed is the default: the rail expands on hover, and pinning it
  // open (⌘B) is the stored exception.
  if (typeof window === 'undefined') return true;
  return window.localStorage.getItem(COLLAPSE_KEY) !== '0';
}

function SidebarBody({
  id,
  onNavigate,
  collapsed = false,
}: {
  /** Namespaces the shared active pill — the desktop rail and the mobile
   * drawer each get their own, so one never tries to fly to the other. */
  id: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const reduce = useReducedMotion();
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

      {/* scrollbar-none: at 40px-wide rows a native scrollbar eats the rail
          and shoves the icons off-center (it did). */}
      <div className="scrollbar-none mt-6 flex flex-col gap-4 overflow-x-hidden overflow-y-auto">
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

            <nav aria-label={group.title ?? 'Main'} className="flex flex-col gap-0.5">
              {group.items.map(({ to, label, icon: Icon, exact }) => {
                const link = (
                  <Link
                    key={to}
                    to={to}
                    activeOptions={{ exact: exact ?? false }}
                    onClick={onNavigate}
                    // Collapsed, the label span is opacity-0 — the accessible
                    // name must survive on the link itself, and the visual
                    // label moves into a tooltip (title="" is mouse-only).
                    aria-label={collapsed ? label : undefined}
                    className="pressable relative isolate flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                    activeProps={{
                      // Reduced motion keeps the plain static fill; otherwise
                      // the shared pill below carries the background.
                      className: cn('!text-foreground', reduce && 'bg-muted'),
                      'aria-current': 'page',
                    }}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && !reduce && (
                          <motion.span
                            aria-hidden="true"
                            layoutId="sidebar-active"
                            className="absolute inset-0 -z-10 rounded-md bg-muted"
                            transition={{
                              type: 'spring',
                              stiffness: 500,
                              damping: 40,
                            }}
                          />
                        )}
                        <Icon className="h-4 w-4 shrink-0" />
                        <span aria-hidden={collapsed} className={labelCls}>
                          {label}
                        </span>
                      </>
                    )}
                  </Link>
                );
                return collapsed ? (
                  <Tooltip key={to} content={label} side="right">
                    {link}
                  </Tooltip>
                ) : (
                  link
                );
              })}
            </nav>
          </div>
        ))}
      </div>
    </LayoutGroup>
  );
}

// Section labels come from the nav config, so a renamed nav item cannot
// drift out of sync with the breadcrumb.

/**
 * Page identity as a shell path, not a breadcrumb trail.
 *
 * Gregale is CLI-first — the location reads the way the product talks:
 * `workspace/section/detail` in the mono voice, separators as slashes.
 * The workspace is the one link (home); the current segment carries
 * `aria-current`.
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

  const trail: string[] = [section ? (SECTION_LABELS[section] ?? section) : 'Overview'];
  if (section === 'workflows' && detail) {
    trail.push(
      detail === 'new' ? 'new' : (workflows.find((w) => w.id === detail)?.name ?? 'workflow')
    );
  }

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-1.5 font-mono text-xs [font-variant-numeric:tabular-nums]"
    >
      <Link
        to="/dashboard"
        className="pressable flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded bg-brand/20 text-[9px] font-semibold uppercase text-brand">
          {workspace.charAt(0)}
        </span>
        <span className="hidden text-muted-foreground sm:inline">{workspace}</span>
      </Link>

      {trail.map((label, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={label} className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden className="shrink-0 text-muted-foreground/40">
              /
            </span>
            <span
              aria-current={last ? 'page' : undefined}
              className={cn(
                'truncate lowercase',
                last ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
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
        className="pressable group flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-1.5 hover:bg-muted data-[state=open]:bg-muted"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
          {user?.initials ?? 'GG'}
        </span>
        {/* The chevron answers the menu: down when closed, up while open. */}
        <NavArrowDown className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ease-console group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <p className="truncate text-sm font-medium">{user?.name}</p>
          <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/dashboard/settings">
            <Settings className="h-3.5 w-3.5" />
            Workspace settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut className="h-3.5 w-3.5" />
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
  // marketing site's paper white above a near-black page.
  useEffect(() => {
    document.documentElement.classList.add('console');

    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previous = meta?.content;
    if (meta) meta.content = '#090909';

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
              <SidebarBody id="desktop" collapsed={railCollapsed} />

              {/* Identity and sign-out live in the top bar's account menu, so the
            sidebar footer carries context instead of duplicating them. */}
              <div className="mt-auto overflow-hidden pt-4">
                {/* The beta note folds its height away smoothly (0fr↔1fr) —
                    an unmount here would jolt the footer as the rail moves. */}
                <div
                  className={cn(
                    'grid transition-[grid-template-rows,opacity] duration-300 ease-console',
                    railCollapsed ? 'grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr] opacity-100'
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="mb-2 w-[13.5rem] rounded-lg border border-border bg-background p-3">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-1.5 w-1.5">
                          <span
                            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                            style={{ background: 'var(--status-good)' }}
                          />
                          <span
                            className="relative inline-flex h-1.5 w-1.5 rounded-full"
                            style={{ background: 'var(--status-good)' }}
                          />
                        </span>
                        <p className="font-mono text-xs">fra-metal-1</p>
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        Private beta on single-node metal. Multi-node scaling is on the roadmap.
                      </p>
                    </div>
                  </div>
                </div>

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
                  className="fixed inset-0 z-50 bg-mint-12/50 backdrop-blur-sm lg:hidden"
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
                  <SidebarBody id="mobile" onNavigate={() => setMobileOpen(false)} />
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
