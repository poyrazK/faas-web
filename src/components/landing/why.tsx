import { Check, Lock } from 'iconoir-react';
import { Cards, Panel, type CardItem } from './cards';
import { TracePreview } from './product-previews';

/**
 * Why Gregale — four reasons in the landing page's card row (see cards.tsx).
 */

export type Reason = CardItem;

const Tick = () => <Check className="size-3 shrink-0 text-brand" />;

export const REASONS: readonly Reason[] = [
  {
    title: 'Idle costs nothing',
    body: 'A parked app holds no resident memory, and idle time doesn’t count against your usage. You pay for the traffic you serve, not for a box kept warm.',
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
      <Panel
        title="example app · idle 14m"
        rows={[
          <>
            <Tick /> state: parked
          </>,
          <>
            <Tick /> resident RAM: 0 MB
          </>,
          <>
            <Tick /> usage billed while parked: none
          </>,
          <span className="text-muted-foreground">next request restores the snapshot</span>,
        ]}
      />
    ),
  },
  {
    title: 'No cold-start tax',
    body: 'A parked app is restored from its snapshot, not rebuilt from scratch. Scaling to zero stops being something you pay for in latency.',
    mosaic: [
      [5, 0, 0],
      [4, 1, 2],
      [3, 2, 0],
      [2, 3, 1],
      [4, 3, 1],
      [5, 4, 2],
      [6, 2, 2],
    ],
    panel: <TracePreview />,
  },
  {
    title: 'Its own kernel',
    body: 'Every app runs in its own Firecracker microVM on bare metal, with its own kernel — not a container sharing a host runtime with other tenants.',
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
        title="example app · microVM"
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
    title: 'Bring your own state',
    body: 'Stateless by design. Plug in the Postgres, bucket or KV you already use: the URL goes in as a sealed secret, and the env var is what your code reads.',
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
    <section id="why" className="relative scroll-mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-20 sm:px-6 sm:pb-20 sm:pt-28">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-4 text-sm font-semibold text-brand">Why Gregale</p>
            <h2 className="max-w-[30rem] text-balance text-[40px] font-medium leading-[1.05] tracking-[-0.02em] text-foreground sm:text-[52px]">
              For APIs that aren’t busy all day.
            </h2>
          </div>
          <p className="max-w-[26rem] text-[15px] leading-[1.35] text-muted-foreground sm:text-base">
            Internal tools, webhooks, scheduled jobs and bursty APIs spend most of their life idle.
            Gregale parks them at zero and brings them back on the next request.
          </p>
        </div>
        <Cards items={REASONS} defaultOpen={1} className="mt-10 lg:mt-12" />
      </div>
    </section>
  );
}
