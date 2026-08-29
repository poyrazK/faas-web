import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowRight, Menu, Xmark } from 'iconoir-react';
import { SweepLink } from '@/components/sweep-link';
import { Button } from '@/components/ui/button';
import { EASE } from './reveal';

/**
 * The site nav, in the page's own material.
 *
 * At rest it is no chrome at all — the wordmark and links sit directly on the
 * hero. Once there is content to sit over it materialises into a floating
 * capsule: a hairline border, the card surface blurred over the page, and a
 * mint-lit top edge, the same lit hairline the footer's CTA panel carries.
 *
 * The links know where you are. A mint dot slides between Platform, Pricing,
 * and Docs as their sections cross the viewport, so the nav doubles as a
 * position indicator on a page that is mostly one long scroll.
 */

interface NavLink {
  label: string;
  /** Landing section this link tracks, for the active dot. */
  section?: 'deploy' | 'pricing';
  route?: '/docs';
}

const LINKS: NavLink[] = [
  { label: 'Platform', section: 'deploy' },
  { label: 'Pricing', section: 'pricing' },
  { label: 'Docs', route: '/docs' },
];

function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <Link
      to="/"
      onClick={onClick}
      className="flex w-fit shrink-0 items-center rounded-md outline-none transition-opacity duration-200 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <img src="/logo.png" alt="Gregale" className="h-8 w-auto" />
    </Link>
  );
}

/**
 * Which link is "current": the docs route when on it, otherwise whichever
 * landing section currently sits in the upper third of the viewport.
 */
function useActiveLink(): string | null {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [section, setSection] = useState<string | null>(null);

  useEffect(() => {
    if (pathname !== '/') return;
    const targets = LINKS.flatMap((l) =>
      l.section ? [document.getElementById(l.section)].filter(Boolean) : []
    ) as HTMLElement[];
    if (!targets.length) return;

    // A band across the upper third of the viewport: a section is current
    // while any part of it crosses that band. Resolved on every callback
    // from live geometry rather than from the entries, which only report
    // the elements that changed.
    const band = () => window.innerHeight * 0.35;
    const resolve = () => {
      const hit = targets.find((t) => {
        const r = t.getBoundingClientRect();
        return r.top <= band() && r.bottom > band();
      });
      setSection(hit ? hit.id : null);
    };
    const io = new IntersectionObserver(resolve, {
      rootMargin: '-35% 0px -65% 0px',
      threshold: 0,
    });
    targets.forEach((t) => io.observe(t));
    resolve();
    return () => io.disconnect();
  }, [pathname]);

  if (pathname.startsWith('/docs')) return 'Docs';
  return LINKS.find((l) => l.section === section)?.label ?? null;
}

const LINK_CLASS =
  'relative rounded-full px-3.5 py-1.5 text-sm outline-none transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50';

function ActiveDot() {
  return (
    <motion.span
      layoutId="nav-active"
      aria-hidden
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
      className="absolute -bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand-fill shadow-[0_0_8px_0_rgba(0,206,145,0.8)]"
    />
  );
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const active = useActiveLink();

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // The panel overlays the page, so the page beneath must not scroll.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // Keyboard users: focus moves into the panel when it opens and back to the
  // toggle when it closes, so it never lands on nothing.
  useEffect(() => {
    if (menuOpen) {
      panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    } else if (wasOpen.current) {
      toggleRef.current?.focus();
    }
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  const raised = scrolled || menuOpen;

  return (
    <motion.header
      initial={{ y: -16, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, delay: 0.15, ease: EASE }}
      className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5"
    >
      {/* The capsule. Width matches the page grid; chrome only when raised. */}
      <div
        className={`relative mx-auto max-w-6xl rounded-[22px] border transition-[background-color,border-color,box-shadow] duration-300 ${
          raised
            ? `border-border shadow-[0_12px_40px_-18px_rgba(13,21,18,0.25)] backdrop-blur-xl ${menuOpen ? 'bg-card/95' : 'bg-card/75'}`
            : 'border-transparent bg-transparent'
        }`}
      >
        {/* Lit top edge, brightest at center — the footer panel's hairline. */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-10 top-0 h-px transition-opacity duration-500 ${
            raised ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            background:
              'linear-gradient(to right, transparent, rgba(0,206,145,0.6) 50%, transparent)',
          }}
        />

        {/* Reading progress along the bottom edge — a mint hairline that
            fills left to right as the page scrolls. Decorative; the scrollbar
            is the accessible instrument. */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-6 bottom-0 h-px origin-left rounded-full bg-brand-fill transition-opacity duration-500 ${
            raised && !menuOpen ? 'opacity-60' : 'opacity-0'
          }`}
          style={{ transform: `scaleX(${progress})` }}
        />

        <div className="flex h-14 items-center justify-between gap-6 pl-4 pr-2 sm:pl-5 lg:grid lg:grid-cols-[1fr_auto_1fr]">
          <Brand />

          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {LINKS.map((link) => {
              const isActive = active === link.label;
              const color = isActive ? 'text-foreground' : 'text-muted-foreground';
              // `/docs` is a route, not an anchor — going through the router
              // preloads its chunk and avoids a full document reload.
              return link.route ? (
                <Link
                  key={link.label}
                  to={link.route}
                  aria-current={isActive ? 'page' : undefined}
                  className={`${LINK_CLASS} ${color}`}
                >
                  {link.label}
                  {isActive && <ActiveDot />}
                </Link>
              ) : (
                // `/#section` rather than `#section`, so the link also works
                // from the docs pages the nav is shared with.
                <a
                  key={link.label}
                  href={`/#${link.section}`}
                  aria-current={isActive ? 'location' : undefined}
                  className={`${LINK_CLASS} ${color}`}
                >
                  {link.label}
                  {isActive && <ActiveDot />}
                </a>
              );
            })}
          </nav>

          <div className="flex items-center gap-1.5 lg:justify-self-end">
            <SweepLink
              to="/login"
              className="hidden rounded-full px-3.5 py-1.5 text-sm text-muted-foreground outline-none transition-colors duration-200 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 sm:block"
            >
              Sign in
            </SweepLink>
            <Button asChild variant="cta" className="group h-9 gap-1.5 rounded-full px-4 text-sm">
              <SweepLink to="/signup">
                Get started
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
              </SweepLink>
            </Button>

            <button
              ref={toggleRef}
              type="button"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen((v) => !v)}
              className="ml-0.5 rounded-full p-2 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 lg:hidden"
            >
              {menuOpen ? <Xmark className="h-4.5 w-4.5" /> : <Menu className="h-4.5 w-4.5" />}
            </button>
          </div>
        </div>

        {/* Mobile panel — the capsule grows downward into a numbered list. */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.28, ease: EASE }}
              className="overflow-hidden lg:hidden"
            >
              <nav
                id="mobile-nav"
                ref={panelRef}
                aria-label="Mobile"
                className="mx-4 flex flex-col border-t border-border py-2 sm:mx-5"
              >
                {LINKS.map((link, i) => {
                  const cls =
                    'flex items-center justify-between py-3.5 text-base text-foreground transition-colors hover:text-brand';
                  const index = (
                    <span className="label-mono text-muted-foreground">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  );
                  return link.route ? (
                    <Link
                      key={link.label}
                      to={link.route}
                      onClick={() => setMenuOpen(false)}
                      className={cls}
                    >
                      {link.label}
                      {index}
                    </Link>
                  ) : (
                    <a
                      key={link.label}
                      href={`/#${link.section}`}
                      onClick={() => setMenuOpen(false)}
                      className={cls}
                    >
                      {link.label}
                      {index}
                    </a>
                  );
                })}
                <SweepLink
                  to="/login"
                  onClick={() => setMenuOpen(false)}
                  className="border-t border-border py-3.5 text-base text-muted-foreground transition-colors hover:text-foreground sm:hidden"
                >
                  Sign in
                </SweepLink>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
}
