import { Link } from '@tanstack/react-router';
import { ArrowRight, ArrowUpRight, Check } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { SweepLink } from '@/components/sweep-link';
import { InstallCommand } from './install-command';
import { Reveal } from './reveal';
import { TextReveal } from './text-reveal';
import { FloorGlow } from './floor-glow';

/**
 * Footer directory.
 *
 * **Every href here resolves.** This was twenty links pointing at `#`, naming
 * pages that do not exist — Careers, Blog, Brand kit, DPA, Sub-processors,
 * Containers. A dead link in a footer is worse than a missing one: it reads as
 * a real page right up until someone clicks it.
 *
 * Destinations are limited to what actually exists: the landing anchors, the
 * app's own routes, `/docs`, the source repository, and the OpenAPI document
 * the API serves.
 *
 * Still absent: Privacy and Terms. Those remain unwritten, and linking a page
 * into existence is the thing this comment exists to prevent. The DPA and the
 * sub-processor list *were* written all along — they sat in the upstream
 * repository and are now published under `/docs`.
 *
 * Changelog is absent too: the repository has no releases to point at.
 */
interface FooterLink {
  label: string;
  href: string;
  /** Leaves the site. Gets an icon and the usual rel hardening. */
  external?: boolean;
  /** An app route rather than an anchor, so the router handles it. */
  route?: '/login' | '/signup' | '/dashboard';
  /** A docs page. `true` is the docs index; a string is that page's slug. */
  doc?: true | string;
}

const LINK_GROUPS: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'How it works', href: '#how' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'Console', href: '/dashboard', route: '/dashboard' },
      { label: 'Start free', href: '/signup', route: '/signup' },
      { label: 'Sign in', href: '/login', route: '/login' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Documentation', href: '/docs', doc: true },
      // Served by apid on this same origin, so it needs no absolute URL.
      { label: 'API reference', href: '/v1/openapi.yaml' },
    ],
  },
  {
    // These used to be absent because the pages did not exist. They do —
    // upstream had a DPA and a sub-processor list all along, now published at
    // /docs. Privacy and Terms are still genuinely unwritten.
    title: 'Trust',
    links: [
      { label: 'Data Processing Agreement', href: '/docs/dpa', doc: 'dpa' },
      { label: 'Sub-processors', href: '/docs/subprocessors', doc: 'subprocessors' },
      {
        label: 'Responsible disclosure',
        href: '/docs/responsible-disclosure',
        doc: 'responsible-disclosure',
      },
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
      <Link to="/docs" reloadDocument className={LINK_CLASS}>
        {link.label}
      </Link>
    );
  }

  if (typeof link.doc === 'string') {
    return (
      <Link to="/docs/$slug" params={{ slug: link.doc }} reloadDocument className={LINK_CLASS}>
        {link.label}
      </Link>
    );
  }

  if (link.route) {
    return (
      <SweepLink to={link.route} reloadDocument className={LINK_CLASS}>
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
    <footer className="landing-deferred relative overflow-hidden border-t border-border">
      {/* The floor glow — Dia's footer gradient in the mint ramp. Anchored to
          the very bottom and rising into view; the wordmark and bottom bar
          sit in front of it, the CTA panel above it. */}
      <FloorGlow blur={28} className="absolute inset-x-0 bottom-0 h-[56%] sm:h-[50%]" />

      {/* Readability scrim over the CTA and link bands, clearing before the
          glow's brightest band so the floor stays plainly lit. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, color-mix(in srgb, var(--background) 92%, transparent) 0%, color-mix(in srgb, var(--background) 82%, transparent) 55%, color-mix(in srgb, var(--background) 40%, transparent) 74%, transparent 88%)',
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
                <SweepLink to="/signup" reloadDocument>
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

      {/* Link directory — hairline rules turn it into a spec sheet */}
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-10 border-t border-border py-14 md:grid-cols-[1.4fr_repeat(4,1fr)] md:gap-6">
          {/* Brand column */}
          <div className="md:pr-8">
            <Link to="/" className="inline-flex items-center">
              <img
                src="/logo.png"
                alt="Gregale"
                width={299}
                height={112}
                loading="lazy"
                decoding="async"
                className="h-7 w-auto"
              />
            </Link>
            <p className="mt-4 max-w-[26ch] text-sm leading-relaxed text-muted-foreground">
              Scale-to-zero serverless on real microVMs. Snapshot cold starts under 350ms.
            </p>
          </div>

          {/* Link groups */}
          {LINK_GROUPS.map((group) => (
            <nav
              key={group.title}
              aria-label={group.title}
              className="md:border-l md:border-border md:pl-6"
            >
              <h3 className="label-mono text-muted-foreground">{group.title}</h3>
              <ul className="mt-4 flex flex-col gap-2.5">
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

      {/* Oversized wordmark, clipped by the footer's bottom edge. It sits in
          front of the dissolve, so it needs real ink: dark where it meets the
          link band, easing off as it drops out of the frame. */}
      <div aria-hidden className="pointer-events-none relative z-10 select-none overflow-hidden">
        <p className="translate-y-[22%] bg-gradient-to-b from-foreground via-[#0f3d2b] to-brand bg-clip-text text-center text-[19vw] font-semibold leading-[0.75] tracking-[-0.05em] text-transparent">
          GREGALE
        </p>
      </div>

      {/* Bottom bar */}
      <div className="relative border-t border-border bg-background/60 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row sm:px-6">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Gregale. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
