import {
  Activity,
  Timer,
  Database,
  GitBranch,
  GitPullRequest,
  Globe,
  Key,
  ShieldCheck,
  Flash,
} from 'iconoir-react';
import { motion } from 'motion/react';
import { BentoCard, BentoGrid } from '@/components/landing/bento-grid';
import { EASE, Reveal } from './reveal';
import { TextReveal } from './text-reveal';
import { FlowLines } from './shapes/flow-lines';
import {
  ChecksCard,
  DeployBeam,
  DomainsCard,
  FilesMarquee,
  WakeTimeline,
  PreviewsCard,
  ProvidersBeam,
  WeekGrid,
  SecretsCard,
} from './bento-backgrounds';

/**
 * Spans encode weight, not decoration: the three two-wide cards are the three
 * things a developer asks first — what runs, where state lives, and how they
 * will know what happened. The layout is 3 columns × 4 rows on `lg`, and a
 * single column below.
 *
 * Order matters for the single-column stack too, so the grid reads top-down
 * in the same priority.
 */
const CARDS = [
  {
    Icon: Flash,
    name: 'Functions',
    description:
      'Node, Python, or Go in a hardware-isolated microVM. Invoke sync or async; every wake restores the same snapshot.',
    doc: 'runtime-node',
    cta: 'Runtimes',
    className: 'lg:col-span-2',
    background: <FilesMarquee />,
  },
  {
    Icon: Timer,
    name: 'Cron & queues',
    description:
      'Schedules, queues with dead-letter, and delayed tasks — without a second service.',
    doc: 'scale-to-zero',
    cta: 'How wakes work',
    background: <WeekGrid />,
  },
  {
    Icon: GitBranch,
    name: 'Deploy from GitHub',
    description:
      'One-shot, SHA-pinned deploys from CI. Every build carries an SBOM and provenance.',
    doc: 'deploy-from-source',
    cta: 'Deploy from a ref',
    background: <DeployBeam />,
  },
  {
    Icon: Database,
    name: 'Bring your own state',
    description:
      'Stateless by design. Plug in the managed Postgres, object store, or KV you already use — the URL is a secret, the env var is what your code reads.',
    doc: 'storage',
    cta: 'Storage guide',
    className: 'lg:col-span-2',
    background: <ProvidersBeam />,
  },
  {
    Icon: Activity,
    name: 'Logs, metrics, invocations',
    description:
      'Streamed logs, per-app metrics, every invocation with its trace, and a timeline for each wake. Alerts when it matters.',
    doc: 'tracing',
    cta: 'Tracing',
    className: 'lg:col-span-2',
    background: <WakeTimeline />,
  },
  {
    Icon: Globe,
    name: 'Domains & edge rules',
    description: 'Custom domains with managed TLS, routes, and edge rules in front of any app.',
    doc: 'preview-environments',
    cta: 'Domains & previews',
    background: <DomainsCard />,
  },
  {
    Icon: Key,
    name: 'Secrets & env',
    description:
      'Sealed at rest, injected as plain env vars at wake. Scoped per app, rotatable from the CLI or console.',
    doc: 'storage',
    cta: 'Wiring secrets',
    background: <SecretsCard />,
  },
  {
    Icon: GitPullRequest,
    name: 'Preview environments',
    description:
      'Every pull request gets its own URL under your app, covered by the wildcard cert.',
    doc: 'preview-environments',
    cta: 'Previews',
    background: <PreviewsCard />,
  },
  {
    Icon: ShieldCheck,
    name: 'Locked down by default',
    description: 'Egress deny-list, secret scanning on every deployment, audit log, MFA.',
    doc: 'egress-denylist',
    cta: 'Egress policy',
    background: <ChecksCard />,
  },
];

export function ComponentsGrid() {
  return (
    <section id="deploy" className="relative scroll-mt-24 overflow-hidden border-t border-border">
      {/* Flow Lines: streamlines echo requests finding their way to an app. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          WebkitMaskImage: 'radial-gradient(80% 70% at 50% 40%, black, transparent 75%)',
          maskImage: 'radial-gradient(80% 70% at 50% 40%, black, transparent 75%)',
        }}
      >
        <FlowLines />
      </div>

      <div className="relative mx-auto max-w-6xl px-4 py-24 sm:px-6">
        <Reveal y={12}>
          <p className="label-mono mb-5 text-brand">Platform</p>
        </Reveal>

        <TextReveal
          as="h2"
          className="max-w-3xl text-3xl leading-[1.15] sm:text-4xl"
          delay={0.12}
          segments={[
            { text: 'Everything a function needs to ship.' },
            {
              text: 'Deploys, schedules, domains, secrets, and observability — one CLI, one API, no glue code.',
              className: 'text-muted-foreground',
            },
          ]}
        />

        {/* Film grain over the whole grid — one SVG turbulence at a few
            percent, multiplied in. It is what makes the cards read as a
            surface with texture rather than flat fills. Pointer-events off,
            aria-hidden, and static, so it costs one raster. */}
        <div className="relative mt-12">
          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 z-20 h-full w-full mix-blend-multiply opacity-[0.045]"
          >
            <filter id="bento-grain">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9"
                numOctaves="2"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect width="100%" height="100%" filter="url(#bento-grain)" />
          </svg>
          <BentoGrid>
            {CARDS.map(({ className, ...card }, i) => (
              <motion.div
                key={card.name}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-60px' }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: EASE }}
                className={`flex ${className ?? ''}`}
              >
                <BentoCard {...card} className="w-full" />
              </motion.div>
            ))}
          </BentoGrid>
        </div>
      </div>
    </section>
  );
}
