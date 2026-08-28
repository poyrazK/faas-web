import { useEffect, useRef, useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  IconoirProvider,
  NavArrowDown,
  NavArrowRight,
  CloudXmark,
  LogOut,
  Menu,
  SidebarCollapse,
  SidebarExpand,
  Search,
  Settings,
  Xmark,
} from 'iconoir-react';
import { useData } from '@/lib/store';
import { readWorkspace, useAuth } from '@/lib/auth';
import { useSweepNavigate } from '@/components/sweep-link';
import { useToast } from '@/components/ui/toast';
import { Kbd } from '@/components/ui/kbd';
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
import { cn } from '@/lib/utils';
import { useFocusTrap } from '@/lib/use-focus-trap';

const COLLAPSE_KEY = 'gregale.sidebar.collapsed';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(COLLAPSE_KEY) === '1';
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
  return (
    <LayoutGroup id={id}>
      <Link
        to="/"
        className={cn('flex items-center gap-2.5 py-1', collapsed ? 'justify-center' : 'px-2.5')}
        aria-label="Gregale home"
      >
        {/* Mint recolours of the wordmark: the brand green vanishes on the
            console's near-black, so the dark surface gets its own step. */}
        {collapsed ? (
          <img src="/mark-on-dark.png" alt="Gregale" className="h-7 w-7" />
        ) : (
          <img src="/logo-on-dark.png" alt="Gregale" className="h-7 w-auto" />
        )}
      </Link>

      <div className="mt-6 flex flex-col gap-5 overflow-y-auto">
        {NAV_GROUPS.map((group, gi) => (
          <div key={group.title ?? `group-${gi}`}>
            {group.title && !collapsed && (
              <p className="label-mono px-2.5 pb-1.5 text-muted-foreground/70">{group.title}</p>
            )}
            {/* Collapsed groups still need separating, but a heading would
                not fit — a hairline carries the same grouping. */}
            {group.title && collapsed && <div className="mx-2 mb-2 h-px bg-border" />}

            <nav aria-label={group.title ?? 'Main'} className="flex flex-col gap-0.5">
              {group.items.map(({ to, label, icon: Icon, exact }) => {
                const link = (
                  <Link
                    key={to}
                    to={to}
                    activeOptions={{ exact: exact ?? false }}
                    onClick={onNavigate}
                    // Collapsed, the label span unmounts — the accessible name
                    // must survive on the link itself, and the visual label
                    // moves into a tooltip (title="" is mouse-only).
                    aria-label={collapsed ? label : undefined}
                    className={cn(
                      'pressable relative isolate flex items-center gap-2.5 rounded-md py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                      collapsed ? 'justify-center px-0' : 'px-2.5'
                    )}
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
                        <AnimatePresence initial={false}>
                          {!collapsed && (
                            <motion.span
                              className="truncate"
                              initial={reduce ? false : { opacity: 0 }}
                              animate={{ opacity: 1 }}
                              // Collapse mirrors expand: the label fades out as
                              // the rail narrows instead of popping away.
                              exit={reduce ? undefined : { opacity: 0 }}
                              transition={{ duration: 0.12 }}
                            >
                              {label}
                            </motion.span>
                          )}
                        </AnimatePresence>
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
 * Page identity for the top bar. Without this the bar anchors nothing — the
 * sidebar knows where you are but the bar itself never said.
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

  const trail: { label: string }[] = [
    { label: section ? (SECTION_LABELS[section] ?? section) : 'Overview' },
  ];

  if (section === 'workflows' && detail) {
    trail.push({
      label:
        detail === 'new' ? 'New app' : (workflows.find((w) => w.id === detail)?.name ?? 'Workflow'),
    });
  }

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      <Link
        to="/dashboard"
        className="pressable flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded bg-brand/20 text-[9px] font-semibold uppercase text-brand">
          {workspace.charAt(0)}
        </span>
        <span className="hidden font-medium sm:inline">{workspace}</span>
      </Link>

      {trail.map((crumb, i) => {
        const last = i === trail.length - 1;
        return (
          <span key={crumb.label} className="flex min-w-0 items-center gap-1.5">
            <NavArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            <span
              aria-current={last ? 'page' : undefined}
              className={cn('truncate px-1 py-0.5', last ? 'font-medium' : 'text-muted-foreground')}
            >
              {crumb.label}
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
        className="pressable flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-1.5 hover:bg-muted data-[state=open]:bg-muted"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
          {user?.initials ?? 'GG'}
        </span>
        <NavArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
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

  // ⌘K / Ctrl+K anywhere in the dashboard; ⌘B toggles the rail, the same
  // binding editors use; Escape closes the mobile drawer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
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
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
              className={cn(
                // The stored width is applied before first paint (readCollapsed
                // in the state initializer), so this transition only ever runs
                // on a real toggle, never on load.
                'fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-border bg-card py-5 transition-[width] duration-200 ease-console lg:flex',
                collapsed ? 'w-[4.5rem] px-2' : 'w-60 px-3'
              )}
            >
              <SidebarBody id="desktop" collapsed={collapsed} />

              {/* Identity and sign-out live in the top bar's account menu, so the
            sidebar footer carries context instead of duplicating them. */}
              <div className="mt-auto pt-4">
                {!collapsed && (
                  <div className="mb-2 rounded-lg border border-border bg-background p-3">
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
                )}

                <Tooltip content={`${collapsed ? 'Expand' : 'Collapse'} sidebar (⌘B)`} side="right">
                  <button
                    type="button"
                    onClick={toggleCollapsed}
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    aria-keyshortcuts="Meta+B Control+B"
                    className={cn(
                      'pressable flex w-full items-center gap-2.5 rounded-md py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground',
                      collapsed ? 'justify-center px-0' : 'px-2.5'
                    )}
                  >
                    {collapsed ? (
                      <SidebarExpand className="h-4 w-4 shrink-0" />
                    ) : (
                      <>
                        <SidebarCollapse className="h-4 w-4 shrink-0" />
                        Collapse
                      </>
                    )}
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
                'console-atmosphere min-h-screen transition-[padding] duration-200 ease-console',
                collapsed ? 'lg:pl-[4.5rem]' : 'lg:pl-60'
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
                  {/* Compact, so identity owns the left rather than a stretched
                field that only ever opens the palette anyway. */}
                  <button
                    type="button"
                    onClick={() => setPaletteOpen(true)}
                    aria-label="Search or jump to"
                    className="pressable flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm text-muted-foreground hover:border-border-secondary hover:text-foreground"
                  >
                    <Search className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden lg:inline">Search</span>
                    <Kbd className="hidden px-1 lg:block">⌘K</Kbd>
                  </button>

                  <span className="mx-1 hidden h-5 w-px bg-border sm:block" />

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
