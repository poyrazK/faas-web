import { Check, GitBranch, Package, Rocket } from 'iconoir-react';
import { useId } from 'react';
import { cn } from '@/lib/utils';
import { Cards, Panel, PANEL_CLASS, PANEL_MONO as MONO, type CardItem } from './cards';

/**
 * The platform as one deploy, told in four stops — in the landing page's
 * card row (see cards.tsx). The nine platform cards this replaced are all
 * here, folded into the stops they belong to, and every docs link they
 * carried is a chip in the open card.
 */

export type Step = CardItem;

const Tick = () => <Check className="size-3 shrink-0 text-brand" />;

export const STEPS: readonly Step[] = [
  {
    title: 'Deploy',
    body: 'One-shot deploys from a Git ref, every build carrying an SBOM and provenance, secrets scanned on the way in and egress denied by default. Each pull request gets its own URL under your domain; custom domains, routes and edge rules sit in front of any app.',
    mosaic: [
      [1, 4, 2],
      [2, 3, 1],
      [3, 2, 0],
      [4, 1, 1],
      [5, 0, 0],
      [3, 4, 2],
      [5, 2, 2],
    ],
    links: [
      { label: 'Deploy from a ref', doc: 'deploy-from-source' },
      { label: 'Previews & domains', doc: 'preview-environments' },
      { label: 'Egress policy', doc: 'egress-denylist' },
    ],
    panel: (
      <Panel
        title="deploy · main"
        rows={[
          <>
            <GitBranch className="size-3 shrink-0 text-muted-foreground" /> 3f9c2e1
            <span className="ml-auto text-muted-foreground">SBOM · provenance</span>
          </>,
          <>
            <Package className="size-3 shrink-0 text-muted-foreground" /> bld_9k2f
            <span className="ml-auto text-muted-foreground">secret scan · 0</span>
          </>,
          <>
            <Rocket className="size-3 shrink-0 text-brand" /> dep_4q7x
            <span className="ml-auto text-status-good">● running</span>
          </>,
          <>
            <Tick /> pr-42.hello.apps.gregale.dev
          </>,
        ]}
      />
    ),
  },
  {
    title: 'Wake',
    body: 'Idle apps snapshot and park at zero. The next request — or a cron tick, or a message on a queue — restores the same snapshot in under 350 ms. Schedules, queues with dead-letter and delayed tasks come with the platform, not a second service.',
    mosaic: [
      [5, 0, 0],
      [4, 1, 2],
      [3, 2, 0],
      [2, 3, 1],
      [4, 3, 1],
      [5, 4, 2],
      [6, 2, 2],
    ],
    links: [{ label: 'How wakes work', doc: 'scale-to-zero' }],
    panel: (
      <Panel
        title="wake sources"
        rows={[
          <>
            <Tick /> GET /<span className="ml-auto text-muted-foreground">restore 214 ms</span>
          </>,
          <>
            <Tick /> 0 */6 * * *<span className="ml-auto text-muted-foreground">nightly-etl</span>
          </>,
          <>
            <Tick /> queue · resize
            <span className="ml-auto text-muted-foreground">3 rows · dlq 0</span>
          </>,
          <>
            <span className="size-3 shrink-0 rounded-full border border-border-secondary" />
            <span className="text-muted-foreground">idle → snapshot · parked at zero</span>
          </>,
        ]}
      />
    ),
  },
  {
    title: 'Run',
    body: 'Handlers run in hardware-isolated microVMs, invoked sync or async. Stateless by design: plug in the managed Postgres, object store or KV you already use — the URL is a sealed secret, the env var is what your code reads, rotatable from the CLI or console.',
    mosaic: [
      [1, 0, 2],
      [2, 1, 0],
      [1, 2, 1],
      [3, 2, 2],
      [4, 1, 1],
      [5, 0, 0],
      [4, 3, 0],
      [5, 4, 1],
      [2, 4, 2],
    ],
    links: [
      { label: 'Runtimes', doc: 'runtime-node' },
      { label: 'Storage & secrets', doc: 'storage' },
    ],
    panel: (
      <Panel
        title="runtimes"
        rows={[
          <>
            <Tick /> node24
            <span className="ml-auto text-muted-foreground">handler.js</span>
          </>,
          <>
            <Tick /> python3.12
            <span className="ml-auto text-muted-foreground">handler.py</span>
          </>,
          <>
            <Tick /> go1.23
            <span className="ml-auto text-muted-foreground">main.go</span>
          </>,
          <>
            <span className="size-3 shrink-0 rounded-full border border-mint-5 bg-mint-2" />
            DATABASE_URL
            <span className="ml-auto rounded-full border border-mint-4 bg-mint-2 px-1.5 text-[9px] leading-[14px] text-brand">
              sealed
            </span>
          </>,
        ]}
      />
    ),
  },
  {
    title: 'Observe',
    body: 'Streamed logs, per-app metrics, a trace for every invocation and a timeline for every wake — alerts when it matters, and an audit log of every write.',
    mosaic: [
      [5, 0, 0],
      [3, 1, 1],
      [5, 1, 2],
      [4, 2, 1],
      [5, 3, 0],
      [3, 4, 0],
      [4, 4, 1],
      [6, 4, 2],
    ],
    links: [{ label: 'Tracing', doc: 'tracing' }],
    panel: (
      <div className={PANEL_CLASS}>
        <div className={cn(MONO, 'flex items-center justify-between text-foreground')}>
          <span>
            wake <span className="text-muted-foreground">wk_2f8a</span>
          </span>
          <span className="text-muted-foreground">340 ms · cold</span>
        </div>
        <div className="mt-2.5 flex h-2.5 w-full gap-px overflow-hidden rounded-sm">
          {[
            ['bg-border-secondary', 12],
            ['bg-brand-fill', 214],
            ['bg-mint-5', 58],
            ['bg-foreground/70', 46],
            ['bg-border-secondary', 10],
          ].map(([tone, ms], i) => (
            <span
              key={i}
              className={cn('h-full', tone as string)}
              style={{ width: `${((ms as number) / 340) * 100}%` }}
            />
          ))}
        </div>
        <pre
          className={cn(
            MONO,
            'mt-2.5 whitespace-pre text-[10px] leading-[1.7] text-muted-foreground'
          )}
        >
          {'hello         GET /         200  340 ms\nimage-resize  POST /resize  200  212 ms'}
        </pre>
      </div>
    ),
  },
];

export function Process() {
  const id = useId();
  return (
    <section
      id="deploy"
      aria-labelledby={`${id}-title`}
      className="relative scroll-mt-24 border-t border-border"
    >
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <h2
          id={`${id}-title`}
          className="max-w-[30rem] text-balance text-[40px] font-medium leading-[1.05] tracking-[-0.02em] text-foreground sm:text-[52px]"
        >
          The platform
        </h2>
        <Cards items={STEPS} defaultOpen={0} className="mt-10 lg:mt-12" />
      </div>
    </section>
  );
}
