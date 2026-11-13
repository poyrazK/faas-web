import { useApp } from '@/lib/api/queries';
import {
  ADVISORY_LIMIT,
  statelessFindings,
  useStatelessAdvisories,
  type StatelessFinding,
} from '@/lib/api/stateless-advisories';
import { Timestamp } from './events/event-format';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { localDiskSentence } from './app-settings-words';
import { Disclosure } from './settings-kit';

const SEVERITY = {
  high: { label: 'High', color: 'var(--status-critical)' },
  warn: { label: 'Warn', color: 'var(--status-warning)' },
} as const;
const SHOWN_PATHS = 3;

function Finding({ finding }: { finding: StatelessFinding }) {
  const severity = SEVERITY[finding.severity];
  const more = finding.paths.length - SHOWN_PATHS;
  return (
    <li className="flex min-w-0 flex-col gap-2 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-medium"
          style={{ color: severity.color, borderColor: severity.color }}
          title={`severity: ${finding.severity}`}
        >
          {severity.label}
        </span>
        <code className="font-mono text-sm [overflow-wrap:anywhere]">{finding.root}</code>
        <span className="text-xs text-muted-foreground">
          {finding.writes} {finding.writes === 1 ? 'write' : 'writes'} · last{' '}
          <Timestamp iso={finding.lastSeen} />
        </span>
      </div>
      <p className="text-sm text-foreground/85">{finding.fix}</p>
      <Disclosure label="Show details" className="gap-2">
        <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">Batches</dt>
          <dd>{finding.batches}</dd>
          <dt className="text-muted-foreground">Paths</dt>
          <dd className="font-mono [overflow-wrap:anywhere]">
            {finding.paths.slice(0, SHOWN_PATHS).join(', ')}
            {more > 0 && <span className="text-muted-foreground"> +{more} more</span>}
          </dd>
          <dt className="text-muted-foreground">Operations</dt>
          <dd>{finding.operations.join(', ') || '—'}</dd>
          <dt className="text-muted-foreground">Instances</dt>
          <dd className="font-mono [overflow-wrap:anywhere]">
            {finding.instances.join(', ') || '—'}
          </dd>
        </dl>
      </Disclosure>
    </li>
  );
}

/**
 * Runtime writes to state-shaped directories, read from the stored
 * `stateless.advisory` audit rows. Per app, not per deployment: faas attributes
 * each batch to the app and instance only (ADR-047).
 */
export function StatelessContract({ slug }: { slug: string }) {
  const app = useApp(slug);
  const appId = app.data?.id ?? '';
  const advisories = useStatelessAdvisories(appId);
  const events = advisories.data?.events ?? [];
  const findings = statelessFindings(events);
  const phase = queryPhase({
    error: app.error ?? advisories.error,
    // A disabled read reports pending forever, so only the app read counts until the id exists.
    loading: appId ? advisories.isPending : app.isPending,
    isEmpty: findings.length === 0,
  });
  const retry = () => void (app.error ? app.refetch() : advisories.refetch());

  return (
    <div role="region" aria-label="Local disk">
      <Panel
        title="Local disk"
        help={
          <>
            Anything written to local disk is lost when the instance parks. Gregale watches /data,
            /db and database directories under /var/lib; that is not a guarantee the app is
            stateless. See{' '}
            <a href="/docs/storage" className="text-brand underline underline-offset-4">
              Storage
            </a>
            .
          </>
        }
        padded={false}
      >
        {(phase === 'ready' || phase === 'empty') && (
          <p className="px-5 pb-3 text-base text-foreground/90">
            {localDiskSentence(findings.length)}
          </p>
        )}
        {phase === 'empty' ? null : phase === 'ready' ? (
          <ul className="divide-y divide-border border-t border-border">
            {findings.map((finding) => (
              <Finding key={finding.root} finding={finding} />
            ))}
          </ul>
        ) : (
          <div className="px-5 py-4">
            <InlinePhase
              phase={phase}
              error={app.error ?? advisories.error}
              loadingMessage="Loading stateless advisories…"
              emptyMessage="No writes to watched paths have been seen for this app."
              onRetry={retry}
            />
          </div>
        )}
        {events.length >= ADVISORY_LIMIT && (
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            Showing the newest {ADVISORY_LIMIT} batches.
          </p>
        )}
      </Panel>
    </div>
  );
}
