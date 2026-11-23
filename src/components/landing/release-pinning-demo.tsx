import { useRef, useState } from 'react';
import {
  ArrowRight,
  Code,
  Globe,
  NavArrowDown,
  Package,
  Refresh,
  Terminal,
  WarningCircle,
} from 'iconoir-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CopperField } from './shaders/copper-field';
import './release-pinning-demo.css';

type Release = 'A' | 'B';
type Phase = 'before-cutover' | 'after-cutover' | 'expired';
type BrowserSession = { release: Release; response?: 'ok' | 'gone' };

const ORDERS = {
  A: { revision: 'v1', description: 'On its way to you.' },
  B: { revision: 'v2', description: 'Estimated delivery tomorrow.' },
} satisfies Record<Release, { revision: string; description: string }>;

const PHASES = {
  'before-cutover': {
    action: 'Publish release B',
    note: 'The first tab opened on release A.',
  },
  'after-cutover': {
    action: 'Expire release A',
    note: 'Release B is live. Check the order in both tabs to see which versions answer.',
  },
  expired: {
    action: 'Restart demo',
    note: 'The compatibility window for release A ended. Check the order in the first tab again.',
  },
} satisfies Record<Phase, { action: string; note: string }>;

function ResponseDiff() {
  return (
    <figure className="mt-3 min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-2.5 text-xs sm:px-4">
        <span className="inline-flex items-center gap-2 font-medium">
          <Code aria-hidden="true" className="size-4 text-muted-foreground" />
          Response diff
        </span>
        <code className="text-muted-foreground">GET /orders/482</code>
      </figcaption>
      <div className="py-1.5 font-mono text-xs leading-6">
        <div className="pl-8 text-muted-foreground sm:pl-10">"status": "in_transit",</div>
        <div className="release-demo-diff-line release-demo-removed">
          <span aria-hidden="true">−</span>
          <span>
            <span className="sr-only">Release A: </span>"delivery_text":{' '}
            {JSON.stringify(ORDERS.A.description)}
          </span>
        </div>
        <div className="release-demo-diff-line release-demo-added">
          <span aria-hidden="true">+</span>
          <span>
            <span className="sr-only">Release B: </span>"delivery_text":{' '}
            {JSON.stringify(ORDERS.B.description)}
          </span>
        </div>
      </div>
    </figure>
  );
}

function BrowserTab({
  title,
  session,
  onRequest,
  onReload,
}: {
  title: string;
  session: BrowserSession | null;
  onRequest: () => void;
  onReload: () => void;
}) {
  const requestButton = useRef<HTMLButtonElement>(null);
  const order = session && ORDERS[session.release];
  return (
    <article
      aria-label={title}
      className="release-demo-tab min-w-0 overflow-hidden rounded-lg border border-border bg-card"
    >
      <header className="release-demo-chrome">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 pt-2.5 sm:px-4">
          <span aria-hidden="true" className="release-demo-window-dots flex shrink-0 gap-1">
            <span />
            <span />
            <span />
          </span>
          <h3 className="release-demo-tab-title flex min-w-0 flex-[1_1_7rem] items-center gap-2 rounded-t-lg px-3 py-2 text-xs font-medium sm:flex-none">
            <Globe aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{title}</span>
          </h3>
        </div>
        <div className="release-demo-toolbar flex min-w-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
          {session && (
            <button
              type="button"
              title="Reload tab"
              aria-label="Reload tab"
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                session.response === 'gone' && 'bg-brand/10 text-brand'
              )}
              onClick={() => {
                onReload();
                requestButton.current?.focus();
              }}
            >
              <Refresh aria-hidden="true" className="size-4" />
            </button>
          )}
          <div className="min-w-0 flex-1 rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {session ? 'orders.example/482' : 'about:blank'}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-border bg-card px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {session && <span aria-hidden="true" className="size-1.5 rounded-full bg-brand/70" />}
            {session ? `Release ${session.release}` : 'Closed'}
          </span>
        </div>
      </header>
      {session && order ? (
        <div className="flex flex-col gap-4 px-3 py-4 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="release-demo-order-icon grid size-10 shrink-0 place-items-center rounded-lg border border-brand/20 text-brand">
                <Package aria-hidden="true" className="size-5" />
              </span>
              <p className="min-w-0 text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">
                Order #482
              </p>
            </div>
            <Button
              ref={requestButton}
              type="button"
              variant="outline"
              className="h-auto min-h-9 max-w-full min-w-0 border-border bg-muted whitespace-normal [overflow-wrap:anywhere] hover:bg-accent"
              onClick={onRequest}
            >
              <span className="min-w-0">Check order</span>
              <ArrowRight aria-hidden="true" className="size-3.5 text-brand" />
            </Button>
          </div>
          <div
            className={cn(
              'min-w-0 rounded-lg border bg-background px-3 py-3',
              session.response === 'gone'
                ? 'release-demo-expired'
                : session.response === 'ok'
                  ? 'border-border'
                  : 'border-dashed border-border'
            )}
            aria-live="polite"
          >
            {session.response === 'gone' ? (
              <div className="flex min-w-0 items-start gap-2.5">
                <WarningCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p className="text-sm font-medium">410 Gone</p>
                  <p className="text-xs text-muted-foreground">
                    Reload this tab to open release B.
                  </p>
                </div>
              </div>
            ) : session.response === 'ok' ? (
              <>
                <ol className="release-demo-tracking" aria-label="Delivery progress">
                  <li data-progress="complete">Placed</li>
                  <li data-progress="current" aria-current="step">
                    In transit
                  </li>
                  <li>Delivered</li>
                </ol>
                <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
                  {order.description}
                </p>
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Terminal aria-hidden="true" className="size-4" />
                  Awaiting request
                </span>
                <code className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  GET /orders/482
                </code>
              </div>
            )}
          </div>
          {session.response && (
            <details className="group min-w-0 border-t border-border pt-3">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <NavArrowDown
                  aria-hidden="true"
                  className="size-3.5 -rotate-90 group-open:rotate-0"
                />
                Request details
                <span
                  className={cn(
                    'ml-auto font-mono',
                    session.response === 'ok' ? 'text-brand' : 'text-foreground'
                  )}
                >
                  {session.response === 'ok' ? '200 OK' : '410 Gone'}
                </span>
              </summary>
              <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1.5 text-xs">
                <dt className="font-mono break-words text-muted-foreground">X-Gregale-Release</dt>
                <dd className="text-right font-mono">release-{session.release.toLowerCase()}</dd>
                {session.response === 'ok' ? (
                  <>
                    <dt className="text-muted-foreground">orders-api</dt>
                    <dd className="text-right font-mono">orders-api-{order.revision}</dd>
                    <dt className="text-muted-foreground">inventory</dt>
                    <dd className="text-right font-mono">inventory-{order.revision}</dd>
                  </>
                ) : (
                  <>
                    <dt className="text-muted-foreground">Rejected at</dt>
                    <dd className="text-right font-mono">Gateway</dd>
                  </>
                )}
              </dl>
            </details>
          )}
        </div>
      ) : (
        <div className="grid min-h-40 flex-1 place-items-center px-4 py-5 text-center">
          <p className="max-w-52 text-sm leading-relaxed text-muted-foreground">
            The second tab opens when you publish release B.
          </p>
        </div>
      )}
    </article>
  );
}

export function ReleasePinningDemo() {
  const [phase, setPhase] = useState<Phase>('before-cutover');
  const [firstTab, setFirstTab] = useState<BrowserSession>({ release: 'A' });
  const [secondTab, setSecondTab] = useState<BrowserSession | null>(null);
  const activeRelease = phase === 'before-cutover' ? 'A' : 'B';

  function advance() {
    switch (phase) {
      case 'before-cutover':
        setPhase('after-cutover');
        setSecondTab({ release: 'B' });
        break;
      case 'after-cutover':
        setPhase('expired');
        break;
      case 'expired':
        setPhase('before-cutover');
        setFirstTab({ release: 'A' });
        setSecondTab(null);
        break;
    }
  }

  return (
    <section
      id="release-demo"
      aria-labelledby="release-demo-title"
      className="scroll-mt-24 border-t border-border"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <h2
              id="release-demo-title"
              className="text-balance text-4xl font-medium leading-[1.05] tracking-tight sm:text-[52px]"
            >
              Keep the old tab open.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
              Ship a new version while someone is still using the old one. See which API and service
              revisions answer each tab.
            </p>
          </div>
          <Link
            to="/docs/$slug"
            params={{ slug: 'service-release-graphs' }}
            className="inline-flex items-center gap-2 rounded-sm text-sm font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            Read about release graphs <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
        <div className="release-demo-stage relative isolate mt-7 overflow-hidden rounded-2xl p-2 sm:mt-9 sm:p-5 lg:p-8">
          <CopperField />
          <div className="release-demo-console relative rounded-xl border border-border bg-background p-3 text-foreground sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-1 pb-4 sm:px-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-medium text-muted-foreground">Interactive simulation</span>
                <span className="inline-flex items-center gap-1.5 rounded-md border border-brand/20 bg-brand/10 px-2 py-1 font-mono text-brand">
                  <span aria-hidden className="size-1.5 rounded-full bg-brand" />
                  Release {activeRelease} live
                </span>
              </div>
              <Button
                type="button"
                variant={phase === 'before-cutover' ? 'default' : 'outline'}
                className="border-border"
                onClick={advance}
              >
                {PHASES[phase].action}
              </Button>
            </div>
            <p className="mb-3 px-1 text-sm text-muted-foreground sm:px-0" role="status">
              {PHASES[phase].note}
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              <BrowserTab
                title="First tab"
                session={firstTab}
                onRequest={() =>
                  setFirstTab({
                    release: firstTab.release,
                    response: phase === 'expired' && firstTab.release === 'A' ? 'gone' : 'ok',
                  })
                }
                onReload={() => setFirstTab({ release: activeRelease, response: 'ok' })}
              />
              <BrowserTab
                title="Second tab"
                session={secondTab}
                onRequest={() => setSecondTab({ release: 'B', response: 'ok' })}
                onReload={() => setSecondTab({ release: activeRelease, response: 'ok' })}
              />
            </div>
            <ResponseDiff />
          </div>
        </div>
      </div>
    </section>
  );
}
