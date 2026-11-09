import type { CSSProperties, ReactNode } from 'react';
import { CheckCircle, MoreHoriz, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useCopy } from '@/components/ui/copy-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Timestamp } from '@/components/ui/timestamp';
import type { Workflow } from '@/lib/mock-data';
import { formatCompact, formatMs } from '@/lib/mock-data';
import type { AppMetrics, Deployment } from '@/lib/api/queries';
import { shortDigest, type VersionTone } from '@/lib/deployment-history-view';
import {
  allClear,
  attentionItems,
  hasTraffic,
  observedMetrics,
  releaseAnswer,
  shortCommit,
  sourceWords,
  trafficSentence,
  versionName,
  windowWords,
  type AttentionItem,
  type ReleaseAnswer,
} from './app-overview-words';
import { HelpTip } from './kit/help-tip';

type Read<T> = { data?: T; isPending: boolean; error: unknown };
type Destination = 'Metrics' | 'Deployments' | 'Logs' | 'Errors' | 'Runtime';

interface AppOverviewProps {
  analytics?: ReactNode;
  app: Workflow;
  releases: Read<Deployment[]>;
  metrics: Read<AppMetrics>;
  metricsAccess: 'checking' | 'available' | 'restricted';
  onNavigate: (tab: Destination, deploymentId?: string) => void;
  onDeploy: () => void;
  onRetryReleases: () => void;
  onRetryMetrics: () => void;
}

const TONE: Record<VersionTone, string> = {
  good: 'var(--status-good)',
  active: 'var(--brand)',
  idle: 'var(--muted-foreground)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
};

/** Colour is never the only signal: the dot always sits beside its word. */
function StatusDot({ tone }: { tone: VersionTone }) {
  const style: CSSProperties =
    tone === 'idle'
      ? { boxShadow: `inset 0 0 0 1.5px ${TONE.idle}` }
      : { backgroundColor: TONE[tone] };
  return <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={style} />;
}

function measured(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * The app's landing view, answer first (docs/console-plain-english.md): which
 * version is live and whether anything needs doing, each as a sentence with
 * one action, then the traffic. All actions lead to existing app-scoped tabs.
 */
export function AppOverview({
  app,
  analytics,
  releases,
  metrics,
  metricsAccess,
  onNavigate,
  onDeploy,
  onRetryReleases,
  onRetryMetrics,
}: AppOverviewProps) {
  const items = releases.data ?? [];
  const answer = releaseAnswer(items);
  const releasesReady = !releases.isPending && !releases.error;
  const rawState = app.reportedStatus?.trim() || app.state;
  const observed =
    metricsAccess === 'available' && !metrics.isPending && !metrics.error
      ? observedMetrics(metrics.data)
      : undefined;
  const flagged = attentionItems({ items, rawState, observed });

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="grid min-w-0 items-start gap-5 surface rounded-[1.25rem] bg-card p-5 sm:p-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] xl:gap-8">
        <section aria-label="Latest release" className="flex min-w-0 flex-col gap-3">
          {releases.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading releases…
            </p>
          ) : (
            <>
              {answer && <ReleaseBlock answer={answer} onNavigate={onNavigate} />}
              {!!releases.error && (
                <div
                  className="flex flex-wrap items-center justify-between gap-3 well rounded-xl bg-muted/40 px-3 py-2.5 text-sm"
                  role="status"
                >
                  <p className="text-muted-foreground">
                    {answer
                      ? 'Last known release. History could not be refreshed.'
                      : 'Release history is unavailable.'}
                  </p>
                  <Button variant="outline" size="xs" onClick={onRetryReleases}>
                    Retry releases
                  </Button>
                </div>
              )}
              {releasesReady && !answer && (
                <div className="flex flex-col items-start gap-3">
                  <span className="bento-label flex items-center gap-2">
                    <StatusDot tone="idle" />
                    Not deployed
                  </span>
                  <p className="text-xl leading-7 font-medium tracking-[-0.01em] text-balance sm:text-2xl sm:leading-8">
                    Nothing is deployed yet.
                  </p>
                  <Button className="mt-1" size="sm" onClick={onDeploy}>
                    Deploy your app
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        <section
          aria-labelledby="overview-attention"
          className="flex min-w-0 flex-col gap-3 well rounded-2xl bg-muted/40 px-4 py-4 sm:px-5"
        >
          <h2 id="overview-attention" className="bento-label">
            Needs attention
          </h2>
          {flagged.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border/60">
              {flagged.map((item) => (
                <AttentionRow key={item.key} item={item} onNavigate={onNavigate} />
              ))}
            </ul>
          ) : (
            <AllClear
              {...allClear({
                releasesKnown: releasesReady && Boolean(answer),
                observed,
                metricsAccess,
              })}
            />
          )}
        </section>
      </div>

      <section
        aria-label="Traffic snapshot"
        className="min-w-0 surface rounded-[1.25rem] bg-card p-5 sm:p-6"
      >
        {analytics ?? (
          <TrafficScalars
            metrics={metrics}
            metricsAccess={metricsAccess}
            observed={observed}
            onNavigate={onNavigate}
            onRetryMetrics={onRetryMetrics}
          />
        )}
      </section>
    </div>
  );
}

function ReleaseBlock({
  answer,
  onNavigate,
}: {
  answer: ReleaseAnswer;
  onNavigate: AppOverviewProps['onNavigate'];
}) {
  const { deployment } = answer;
  const commit = shortCommit(deployment.commit_sha);
  const digest = shortDigest(deployment.image_digest);
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span className="bento-label flex items-center gap-2" title={deployment.status}>
          <StatusDot tone={answer.tone} />
          {answer.label}
        </span>
        <ReleaseMenu deployment={deployment} onNavigate={onNavigate} />
      </div>
      <p className="text-xl leading-7 font-medium tracking-[-0.01em] text-balance sm:text-2xl sm:leading-8">
        {answer.headline}
      </p>
      {answer.detail.length > 0 && (
        <p className="text-sm text-muted-foreground">{answer.detail.join(' ')}</p>
      )}
      <p className="text-[13px] leading-5 text-muted-foreground [font-variant-numeric:tabular-nums]">
        Deployed <Timestamp value={deployment.created_at} /> from {sourceWords(deployment.kind)}
        {commit && (
          <>
            {' · commit '}
            <span className="font-mono text-xs" title={deployment.commit_sha ?? undefined}>
              {commit}
            </span>
          </>
        )}
        {digest && (
          <>
            {' · image '}
            <span className="font-mono text-xs" title={deployment.image_digest ?? undefined}>
              {digest}
            </span>
          </>
        )}
      </p>
      <div className="mt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onNavigate('Deployments', deployment.id)}
        >
          Open release <span className="sr-only">{versionName(deployment)}</span>
        </Button>
      </div>
    </>
  );
}

/** Secondary places and the full identifiers, one click away. */
function ReleaseMenu({
  deployment,
  onNavigate,
}: {
  deployment: Deployment;
  onNavigate: AppOverviewProps['onNavigate'];
}) {
  const { copy } = useCopy();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="More release actions"
        className="pressable -my-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand"
      >
        <MoreHoriz aria-hidden className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onNavigate('Deployments')}>
          See all versions
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onNavigate('Runtime')}>
          View app configuration
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1 h-px bg-border" />
        <DropdownMenuItem onSelect={() => void copy(deployment.id)}>
          Copy release ID
        </DropdownMenuItem>
        {deployment.commit_sha && (
          <DropdownMenuItem onSelect={() => void copy(deployment.commit_sha!)}>
            Copy commit
          </DropdownMenuItem>
        )}
        {deployment.image_digest && (
          <DropdownMenuItem onSelect={() => void copy(deployment.image_digest!)}>
            Copy image digest
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AttentionRow({
  item,
  onNavigate,
}: {
  item: AttentionItem;
  onNavigate: AppOverviewProps['onNavigate'];
}) {
  const color = item.key === 'requests' ? 'var(--status-warning)' : 'var(--status-critical)';
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <WarningTriangle aria-hidden className="mt-0.5 size-4 shrink-0" style={{ color }} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <p className="text-[15px] leading-6 font-medium [overflow-wrap:anywhere]" title={item.term}>
          {item.sentence}
        </p>
        {item.detail && (
          <p className="line-clamp-2 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
            {item.detail}
          </p>
        )}
        <div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => onNavigate(item.action.tab, item.action.deploymentId)}
          >
            {item.action.label}
          </Button>
        </div>
      </div>
    </li>
  );
}

function AllClear({ sentence, note }: { sentence: string; note?: string }) {
  return (
    <div className="flex items-start gap-3">
      <CheckCircle aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-1">
        <p className="text-[15px] leading-6 font-medium">{sentence}</p>
        {note && <p className="text-sm leading-relaxed text-muted-foreground">{note}</p>}
      </div>
    </div>
  );
}

/** Traffic without the hourly series: the metrics scalars, never drawn as a chart. */
function TrafficScalars({
  metrics,
  metricsAccess,
  observed,
  onNavigate,
  onRetryMetrics,
}: {
  metrics: Read<AppMetrics>;
  metricsAccess: AppOverviewProps['metricsAccess'];
  observed: AppMetrics | undefined;
  onNavigate: AppOverviewProps['onNavigate'];
  onRetryMetrics: () => void;
}) {
  const traffic = hasTraffic(observed);
  const sentence = observed
    ? trafficSentence(
        {
          requests: observed.request_count,
          error_rate_pct: traffic ? observed.error_rate_pct : undefined,
        },
        observed.range
      )
    : undefined;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-1 text-base font-medium">
          Traffic
          {observed && (
            <HelpTip label="About these figures">
              Totals for {windowWords(observed.range)}, as of{' '}
              <Timestamp value={observed.as_of} mode="absolute" />. Response time covers successful
              (2xx) responses.
            </HelpTip>
          )}
        </h2>
        {metricsAccess === 'available' && (
          <Button size="xs" variant="ghost" onClick={() => onNavigate('Metrics')}>
            View metrics
          </Button>
        )}
      </div>
      {metricsAccess === 'checking' || (metricsAccess === 'available' && metrics.isPending) ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading traffic signals…
        </p>
      ) : metricsAccess === 'restricted' ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          Request metrics are available on Hobby and above.
        </p>
      ) : !observed ? (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <p className="text-sm text-muted-foreground">Traffic metrics are unavailable.</p>
          <Button size="xs" variant="outline" onClick={onRetryMetrics}>
            Retry metrics
          </Button>
        </div>
      ) : (
        <>
          {sentence && <p className="text-[15px] leading-6">{sentence}</p>}
          {traffic && (
            <dl className="grid grid-cols-3 gap-3 sm:gap-5">
              <Signal
                label="Requests"
                value={
                  measured(observed.request_count)
                    ? formatCompact(observed.request_count)
                    : 'Unavailable'
                }
              />
              <Signal
                label="Error rate"
                value={
                  measured(observed.error_rate_pct) ? `${observed.error_rate_pct.toFixed(2)}%` : '—'
                }
              />
              <Signal
                label="Response time"
                term="p95, successful (2xx) responses"
                value={measured(observed.latency_p95_ms) ? formatMs(observed.latency_p95_ms) : '—'}
              />
            </dl>
          )}
        </>
      )}
    </div>
  );
}

function Signal({ label, value, term }: { label: string; value: string; term?: string }) {
  return (
    <div className="well rounded-xl bg-muted/40 px-3 py-2.5">
      <dt className="text-xs text-muted-foreground" title={term}>
        {label}
      </dt>
      <dd className="mt-1.5 text-xl font-medium tracking-tight [font-variant-numeric:tabular-nums]">
        {value}
      </dd>
    </div>
  );
}
