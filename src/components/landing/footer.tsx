import { Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight, Check } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { SweepLink } from '@/components/sweep-link';
import { InstallCommand } from './install-command';
import { Reveal } from './reveal';
import { TextReveal } from './text-reveal';
import { FloorGlow } from './floor-glow';

/**
 * Footer directory — a wide six-column index, logo at the far left.
 *
 * **Every href here resolves.** This was twenty links pointing at `#`, naming
 * pages that do not exist — Careers, Blog, Brand kit, DPA, Sub-processors,
 * Containers. A dead link in a footer is worse than a missing one: it reads as
 * a real page right up until someone clicks it.
 *
 * So the columns are filled from what exists rather than from the shape of the
 * grid: the landing anchors, the app's own routes, the fourteen published docs
 * (titles taken from `docs-manifest.ts`, so a renamed page renames itself
 * here), and the OpenAPI document the API serves on this origin. A column is
 * short when the material is short.
 *
 * Still absent: Privacy and Terms, which remain unwritten; social accounts,
 * which the site does not have; and a language selector, because there is one
 * language. Each of those is a link this footer would have to invent.
 */
interface FooterLink {
  label: string;
  href: string;
  /** Leaves the site. Gets an icon and the usual rel hardening. */
  external?: boolean;
  /** An app route rather than an anchor, so the router handles it. */
  route?: '/login' | '/signup' | '/dashboard';
  /** A public app route without the marketing-to-product sweep. */
  publicRoute?: '/status';
  /** A docs page. `true` is the docs index; a string is that page's slug. */
  doc?: true | string;
}

const LINK_GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '#how' },
      { label: 'Why microVMs', href: '#why' },
      { label: 'Deploying', href: '#deploy' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
  {
    title: 'Runtimes',
    links: [
      { label: 'Node 24', href: '/docs/runtime-node', doc: 'runtime-node' },
      { label: 'Python 3.13', href: '/docs/runtime-python', doc: 'runtime-python' },
      { label: 'Go 1.24', href: '/docs/runtime-go', doc: 'runtime-go' },
      { label: 'Trace propagation', href: '/docs/tracing', doc: 'tracing' },
    ],
  },
  {
    title: 'Platform',
    links: [
      { label: 'Scaling to zero', href: '/docs/scale-to-zero', doc: 'scale-to-zero' },
      { label: 'Storage', href: '/docs/storage', doc: 'storage' },
      {
        label: 'Preview environments',
        href: '/docs/preview-environments',
        doc: 'preview-environments',
      },
      { label: 'Egress denylist', href: '/docs/egress-denylist', doc: 'egress-denylist' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Documentation', href: '/docs', doc: true },
      {
        label: 'Deploying from source',
        href: '/docs/deploy-from-source',
        doc: 'deploy-from-source',
      },
      { label: 'CLI setup', href: '/docs/cli', doc: 'cli' },
      // Served by apid on this same origin, so it needs no absolute URL.
      { label: 'API reference', href: '/v1/openapi.yaml' },
    ],
  },
  {
    title: 'Trust & safety',
    links: [
      { label: 'Status', href: '/status', publicRoute: '/status' },
      { label: 'Compliance', href: '/docs/compliance', doc: 'compliance' },
      { label: 'Data Processing Agreement', href: '/docs/dpa', doc: 'dpa' },
      { label: 'Sub-processors', href: '/docs/subprocessors', doc: 'subprocessors' },
      {
        label: 'Responsible disclosure',
        href: '/docs/responsible-disclosure',
        doc: 'responsible-disclosure',
      },
    ],
  },
  {
    title: 'Account',
    links: [
      { label: 'Console', href: '/dashboard', route: '/dashboard' },
      { label: 'Start free', href: '/signup', route: '/signup' },
      { label: 'Sign in', href: '/login', route: '/login' },
    ],
  },
];

const TRUST_POINTS = ['No credit card', '1M invocations free', 'Under 350ms cold starts'];

const LINK_CLASS =
  'group inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground';

/**
 * One link, rendered three ways.
 *
 * In-app routes go through the router so they preload and do not reload the
 * document; anchors and same-origin files served by `apid` (the OpenAPI
 * document, `security.txt`) are plain `<a>`, because the router does not own
 * those paths and would 404 them.
 */
function FooterAnchor({ link }: { link: FooterLink }) {
  const icon = link.external && (
    <ArrowUpRight className="h-3 w-3 -translate-x-0.5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
  );

  // Docs are lateral navigation, so they get a plain router link. The sweep is
  // reserved for the hand-off from marketing into the product.
  if (link.doc === true) {
    return (
      <Link to="/docs" className={LINK_CLASS}>
        {link.label}
      </Link>
    );
  }

  if (typeof link.doc === 'string') {
    return (
      <Link to="/docs/$slug" params={{ slug: link.doc }} className={LINK_CLASS}>
        {link.label}
      </Link>
    );
  }

  if (link.publicRoute) {
    return (
      <Link to={link.publicRoute} className={LINK_CLASS}>
        {link.label}
      </Link>
    );
  }

  if (link.route) {
    return (
      <SweepLink to={link.route} className={LINK_CLASS}>
        {link.label}
      </SweepLink>
    );
  }

  return (
    <a
      href={link.href}
      className={LINK_CLASS}
      // noopener is the security-relevant half; noreferrer keeps the referrer
      // off third parties.
      {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {link.label}
      {icon}
    </a>
  );
}

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-border">
      {/* The floor glow — Dia's footer gradient in the mint ramp. Anchored to
          the very bottom and rising into view; the wordmark and bottom bar
          sit in front of it, the CTA panel above it. */}
      {/* The directory is six columns now, which stacks into three tall rows on
          a phone. The glow is pinned lower there so it stays a floor under the
          wordmark rather than rising behind the links. */}
      <FloorGlow blur={28} className="absolute inset-x-0 bottom-0 h-[34%] sm:h-[46%] lg:h-[50%]" />

      {/* Readability scrim over the CTA and link bands, clearing before the
          glow's brightest band so the floor stays plainly lit. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, color-mix(in srgb, var(--background) 92%, transparent) 0%, color-mix(in srgb, var(--background) 88%, transparent) 62%, color-mix(in srgb, var(--background) 45%, transparent) 78%, transparent 90%)',
        }}
      />

      {/* Hairline that brightens toward the center, separating the footer from the page. */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(to right, transparent, rgba(0,206,145,0.55) 50%, transparent)',
        }}
      />

      {/* Closing CTA — contained panel so the conversion moment has edges */}
      <section className="relative px-4 pb-16 pt-20 sm:px-6 sm:pt-24">
        {/* Translucent with a heavy blur, so the footer-wide dissolve reads
            through the panel as a soft glow rather than as dots under text. */}
        <div className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-border bg-card/55 px-6 py-14 text-center backdrop-blur-2xl sm:px-12 sm:py-16">
          {/* Lit top edge, brightest at center */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background:
                'linear-gradient(to right, transparent, rgba(0,206,145,0.6) 50%, transparent)',
            }}
          />

          <Reveal y={12}>
            <p className="label-mono relative text-brand">Get started</p>
          </Reveal>

          {/* The heading animates per word, so it sits outside the block
              Reveal — nesting the two would fight over the same transform. */}
          <TextReveal
            as="h2"
            className="relative mt-5 text-4xl leading-[1.08] sm:text-5xl"
            delay={0.1}
            segments={[
              { text: 'Ship your first function in' },
              { text: 'minutes.', className: 'text-brand' },
            ]}
          />

          {/* Everything below the headline arrives together, once the words
              have landed. */}
          <Reveal delay={0.45}>
            <p className="relative mx-auto mt-4 max-w-md text-balance text-muted-foreground">
              One command from repository to running microVM. Scale-to-zero means idle costs
              nothing.
            </p>

            <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button
                asChild
                variant="cta"
                size="lg"
                className="group h-11 gap-2 rounded-full px-7"
              >
                <SweepLink to="/signup">
                  Start deploying
                  <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </SweepLink>
              </Button>
              <InstallCommand />
            </div>

            <ul className="relative mt-9 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {TRUST_POINTS.map((point) => (
                <li key={point} className="flex items-center gap-2">
                  <Check className="h-3 w-3 shrink-0 text-brand" />
                  <span className="label-mono text-muted-foreground">{point}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* Link directory. The mark sits in its own narrow column at the far
          left and the six groups share the rest evenly, so the eye reads one
          band of headings rather than a brand block and some lists. No rules
          between columns: the whitespace does that work. */}
      <div className="relative mx-auto max-w-[88rem] px-4 sm:px-8">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 border-t border-border py-16 sm:grid-cols-3 lg:grid-cols-[15rem_repeat(6,minmax(0,1fr))] lg:gap-x-10">
          {/* Brand mark. Spans the full row on small screens so the columns
              below it start clean. */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-1 lg:pr-10">
            <Link to="/" className="inline-flex items-center" aria-label="Gregale home">
              <img src="/logo.png" alt="Gregale" className="h-7 w-auto" />
            </Link>
            {/* The copyright rides with the mark. Below the columns it landed
                three quarters of the way down the footer, which is inside the
                floor glow — grey text on a rising green wash. Here it sits on
                the same clean ground as the links. */}
            <p className="mt-6 text-xs text-muted-foreground">
              © {new Date().getFullYear()} Gregale. All rights reserved.
            </p>
          </div>

          {LINK_GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h3 className="text-sm font-medium text-foreground">{group.title}</h3>
              <ul className="mt-4 flex flex-col gap-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <FooterAnchor link={link} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>

      {/* Oversized wordmark, clipped by the footer's bottom edge, and now the
          last thing on the page — nothing follows it, so the crop is the end
          of the document rather than a seam before another band. It sits in
          front of the dissolve, so it needs real ink: dark where it meets the
          link band, easing off as it drops out of the frame. */}
      <div aria-hidden className="pointer-events-none relative z-10 select-none overflow-hidden">
        <p className="translate-y-[22%] bg-gradient-to-b from-foreground via-[#0f3d2b] to-brand bg-clip-text text-center text-[19vw] font-semibold leading-[0.75] tracking-[-0.05em] text-transparent">
          GREGALE
        </p>
      </div>
    </footer>
  );
}
