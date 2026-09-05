import { Check, Lock } from 'iconoir-react';
import { cn } from '@/lib/utils';
import { Cards, Panel, PANEL_CLASS, PANEL_MONO as MONO, type CardItem } from './cards';

/**
 * Why Gregale — four reasons in the landing page's card row (see cards.tsx).
 */

export type Reason = CardItem;

const Tick = () => <Check className="size-3 shrink-0 text-brand" />;

export const REASONS: readonly Reason[] = [
  {
    title: 'Hardware-isolated',
    body: 'Every app runs in its own Firecracker microVM on bare metal, with its own kernel. Noisy neighbours and shared runtimes are somebody else’s problem.',
    mosaic: [
      [4, 0, 0],
      [3, 1, 2],
      [5, 1, 1],
      [4, 2, 2],
      [4, 3, 1],
      [5, 4, 0],
    ],
    panel: (
      <Panel
        title="hello · microVM"
        rows={[
          <>
            <Tick /> Firecracker · own kernel
          </>,
          <>
            <Tick /> 2 vCPU · 512 MB
          </>,
          <>
            <Tick /> snapshot on idle
          </>,
          <>
            <Lock className="size-3 shrink-0 text-muted-foreground" />
            <span className="text-muted-foreground">egress: deny by default</span>
          </>,
        ]}
      />
    ),
  },
  {
    title: 'Back in under 350 ms',
    body: 'Idle apps snapshot to disk and park at zero. The next request restores the same snapshot in under 350 ms — scale-to-zero that costs a blink, not a cold start.',
    mosaic: [
      [5, 0, 0],
      [4, 1, 2],
      [3, 2, 0],
      [2, 3, 1],
      [4, 3, 1],
      [5, 4, 2],
      [6, 2, 2],
    ],
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
        <div className={cn(MONO, 'mt-2 flex justify-between text-muted-foreground')}>
          <span>0</span>
          <span className="text-brand">restore 214 ms</span>
          <span>340 ms</span>
        </div>
      </div>
    ),
  },
  {
    title: 'One CLI, one API',
    body: 'Deploys, schedules, domains, secrets and logs behind one CLI and one API — the same surface for you and for the agents you run.',
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
    panel: (
      <div className="w-[15.5rem] rounded-lg bg-[#0d1512] p-3 shadow-[0_10px_24px_-12px_rgba(13,21,18,0.4)]">
        <div className={cn(MONO, 'flex items-center gap-1.5 text-[#8fb3a6]')}>
          <span className="size-1.5 rounded-full bg-[#2a3d37]" />
          <span className="size-1.5 rounded-full bg-[#2a3d37]" />
          <span className="size-1.5 rounded-full bg-[#2a3d37]" />
          <span className="ml-1">hello — zsh</span>
        </div>
        <pre
          className={cn(
            MONO,
            'mt-2.5 whitespace-pre-wrap text-[11px] leading-[1.7] text-[#e6f4ee]'
          )}
        >
          <span className="text-brand-fill">$</span> gregale deploy --ref main{'\n'}
          <span className="text-[#8fb3a6]">Deployed hello · bld_9k2f</span>
          {'\n'}
          <span className="text-brand-fill">$</span> gregale cron add &quot;0 */6 * * *&quot;
        </pre>
      </div>
    ),
  },
  {
    title: 'Bring your own state',
    body: 'Stateless by design. Plug in the Postgres, object store or KV you already use — the URL is a sealed secret, the env var is what your code reads.',
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
    panel: (
      <Panel
        title="env · at wake"
        rows={[
          <>
            DATABASE_URL{' '}
            <span className="ml-auto tracking-[0.2em] text-muted-foreground">••••</span>
            <span className="rounded-full border border-mint-4 bg-mint-2 px-1.5 text-[9px] leading-[14px] text-brand">
              sealed
            </span>
          </>,
          <>
            S3_BUCKET_URL{' '}
            <span className="ml-auto tracking-[0.2em] text-muted-foreground">••••</span>
            <span className="rounded-full border border-mint-4 bg-mint-2 px-1.5 text-[9px] leading-[14px] text-brand">
              sealed
            </span>
          </>,
          <>
            REDIS_URL <span className="ml-auto tracking-[0.2em] text-muted-foreground">••••</span>
            <span className="rounded-full border border-mint-4 bg-mint-2 px-1.5 text-[9px] leading-[14px] text-brand">
              sealed
            </span>
          </>,
        ]}
      />
    ),
  },
];

export function Why() {
  return (
    <section id="why" className="landing-deferred relative scroll-mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-4 text-sm font-semibold text-brand">Why Gregale</p>
            <h2 className="max-w-[30rem] text-balance text-[40px] font-medium leading-[1.05] tracking-[-0.02em] text-foreground sm:text-[52px]">
              Real microVMs, not containers in disguise
            </h2>
          </div>
          <p className="max-w-[26rem] text-[15px] leading-[1.35] text-muted-foreground sm:text-base">
            Most serverless runs your code in a shared container and hopes. Gregale gives every
            function its own Firecracker VM — isolated, snapshotted when idle, and back in under 350
            ms.
          </p>
        </div>
        <Cards items={REASONS} defaultOpen={1} className="mt-10 lg:mt-12" />
      </div>
    </section>
  );
}
