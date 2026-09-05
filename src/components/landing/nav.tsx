import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Link, useRouterState } from '@tanstack/react-router';
import { ArrowRight, Menu, Xmark } from 'iconoir-react';
import { SweepLink } from '@/components/sweep-link';
import { Button } from '@/components/ui/button';
import { EASE } from './reveal';
import { cn } from '@/lib/utils';
import navMark from '@/assets/landing/mark-64.webp';

/**
 * The site nav — one compact glass pill floating top-centre, cut from the
 * same material as the hero's command pill: a blurred paper surface, a
 * hairline, a soft shadow. Present from the first frame rather than
 * materialising on scroll; what scroll does is settle it — the shadow deepens
 * and the pill draws in a little, the way a thing does when it lands.
 *
 * Contents left to right: the mark (home), the three links with the sliding
 * active dot, Sign in, and the primary action in the site's mint — the same
 * lit, sweeping button the hero and footer use. On phones the links fold into a card that drops from the island.
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
    const band = () => window.innerHeight * 0.35;
    const resolve = () => {
      const hit = targets.find((t) => {
        const r = t.getBoundingClientRect();
        return r.top <= band() && r.bottom > band();
      });
      setSection(hit ? hit.id : null);
    };
    const io = new IntersectionObserver(resolve, { rootMargin: '-35% 0px -65% 0px', threshold: 0 });
    targets.forEach((t) => io.observe(t));
    resolve();
    return () => io.disconnect();
  }, [pathname]);

  if (pathname.startsWith('/docs')) return 'Docs';
  return LINKS.find((l) => l.section === section)?.label ?? null;
}

const LINK =
  'relative rounded-full px-3 py-1.5 text-[13.5px] font-medium outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50';

function ActiveDot() {
  return (
    <motion.span
      layoutId="nav-active"
      aria-hidden
      transition={{ type: 'spring', stiffness: 420, damping: 36 }}
      className="absolute -bottom-px left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-brand-fill shadow-[0_0_8px_0_rgba(0,206,145,0.8)]"
    />
  );
}

function NavItem({
  link,
  active,
  className,
  onClick,
  reloadDocument,
}: {
  link: NavLink;
  active: boolean;
  className: string;
  onClick?: () => void;
  reloadDocument?: boolean;
}) {
  const inner = (
    <>
      {link.label}
      {active && <ActiveDot />}
    </>
  );
  // `/docs` is a route (preloads through the router); sections are anchors
  // written as `/#id` so they work from the docs pages too.
  return link.route ? (
    <Link
      to={link.route}
      reloadDocument={reloadDocument}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={className}
    >
      {inner}
    </Link>
  ) : (
    <a
      href={`/#${link.section}`}
      onClick={onClick}
      aria-current={active ? 'location' : undefined}
      className={className}
    >
      {inner}
    </a>
  );
}

export function Nav({ reloadDocument = false }: { reloadDocument?: boolean }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const active = useActiveLink();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // Focus follows the panel: in when it opens, back to the toggle when it closes.
  useEffect(() => {
    if (menuOpen) panelRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    else if (wasOpen.current) toggleRef.current?.focus();
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  const close = () => setMenuOpen(false);

  return (
    <motion.header
      initial={false}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, delay: 0.1, ease: EASE }}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-4"
    >
      <div className="pointer-events-auto relative">
        {/* the island */}
        <motion.div
          animate={{ scale: scrolled ? 0.985 : 1 }}
          transition={{ duration: 0.4, ease: EASE }}
          className={cn(
            'flex h-12 items-center gap-0.5 rounded-full border border-[color-mix(in_srgb,var(--foreground)_9%,transparent)] pl-1.5 pr-1.5 backdrop-blur-xl transition-[background-color,box-shadow] duration-400',
            'bg-[color-mix(in_srgb,var(--card)_72%,transparent)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.8),0_1px_2px_rgba(13,21,18,0.06),0_10px_30px_-12px_rgba(13,21,18,0.18)]',
            scrolled &&
              'bg-[color-mix(in_srgb,var(--card)_86%,transparent)] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.9),0_1px_2px_rgba(13,21,18,0.08),0_16px_40px_-14px_rgba(13,21,18,0.3)]'
          )}
        >
          {/* the mark, home */}
          <Link
            to="/"
            aria-label="Gregale"
            onClick={close}
            className="flex size-9 shrink-0 items-center justify-center rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <img src={navMark} alt="" width={64} height={64} className="size-7" />
          </Link>

          <nav aria-label="Primary" className="hidden items-center lg:flex">
            {LINKS.map((link) => (
              <NavItem
                key={link.label}
                link={link}
                active={active === link.label}
                reloadDocument={reloadDocument}
                className={cn(LINK, active === link.label ? 'text-foreground' : 'text-[#3d4a45]')}
              />
            ))}
          </nav>

          <span aria-hidden className="mx-1 hidden h-5 w-px bg-border lg:block" />

          <SweepLink
            to="/login"
            reloadDocument={reloadDocument}
            className={cn(LINK, 'hidden text-[#3d4a45] sm:block')}
          >
            Sign in
          </SweepLink>

          <Button
            asChild
            variant="cta"
            className="group ml-0.5 h-9 gap-1.5 rounded-full pl-4 pr-3 text-[13.5px] font-semibold"
          >
            <SweepLink to="/signup" reloadDocument={reloadDocument}>
              Get started
              <ArrowRight className="size-3.5 transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </SweepLink>
          </Button>

          <button
            ref={toggleRef}
            type="button"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
            className="ml-0.5 flex size-9 items-center justify-center rounded-full text-[#3d4a45] outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 lg:hidden"
          >
            {menuOpen ? <Xmark className="size-4.5" /> : <Menu className="size-4.5" />}
          </button>
        </motion.div>

        {/* phones: the links drop from the island as a card */}
        <AnimatePresence>
          {menuOpen && (
            <motion.nav
              id="mobile-nav"
              ref={panelRef}
              aria-label="Mobile"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.22, ease: EASE }}
              className="absolute inset-x-0 top-[calc(100%+8px)] flex flex-col rounded-2xl border border-[color-mix(in_srgb,var(--foreground)_9%,transparent)] bg-[color-mix(in_srgb,var(--card)_92%,transparent)] p-2 shadow-[0_16px_40px_-14px_rgba(13,21,18,0.3)] backdrop-blur-xl lg:hidden"
            >
              {LINKS.map((link) => (
                <NavItem
                  key={link.label}
                  link={link}
                  active={active === link.label}
                  reloadDocument={reloadDocument}
                  onClick={close}
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 text-[15px] text-foreground transition-colors hover:bg-accent"
                />
              ))}
              <SweepLink
                to="/login"
                reloadDocument={reloadDocument}
                onClick={close}
                className="mt-1 border-t border-border px-3 pt-3 pb-1.5 text-[15px] text-[#3d4a45] transition-colors hover:text-foreground sm:hidden"
              >
                Sign in
              </SweepLink>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </motion.header>
  );
}
