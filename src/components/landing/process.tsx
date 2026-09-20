import { Check } from 'iconoir-react';
import { useId } from 'react';
import { Cards, Panel, type CardItem } from './cards';
import { DeploymentPreview, TracePreview, WakeSourcesPreview } from './product-previews';

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
    body: 'Connect a repo and pick a branch. Every pull request gets its own URL under your domain, and egress stays denied by default until you open it.',
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
    panel: <DeploymentPreview />,
  },
  {
    title: 'Run',
    body: 'Node, Python or Go, each in a microVM of its own. The database or bucket you already use goes in as a sealed secret, never in your source.',
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
            <Tick /> python313
            <span className="ml-auto text-muted-foreground">handler.py</span>
          </>,
          <>
            <Tick /> go124
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
    title: 'Park & wake',
    body: 'When traffic stops, the app snapshots to disk and drops to zero. The next request — or a cron tick, or a queue message — restores that snapshot instead of booting from scratch.',
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
    panel: <WakeSourcesPreview />,
  },
  {
    title: 'Observe',
    body: 'Streamed logs, a trace for every invocation, and a deployment that failed for a reason you can read instead of guess at.',
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
    panel: <TracePreview requests />,
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
          From code to a running app.
        </h2>
        <Cards items={STEPS} defaultOpen={0} className="mt-10 lg:mt-12" />
      </div>
    </section>
  );
}
