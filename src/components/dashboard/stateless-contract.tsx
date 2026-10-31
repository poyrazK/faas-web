import { useApp } from '@/lib/api/queries';
import {
  ADVISORY_LIMIT,
  statelessFindings,
  useStatelessAdvisories,
  type StatelessFinding,
} from '@/lib/api/stateless-advisories';
import { Timestamp } from './events/event-format';
import { InlinePhase, Panel, queryPhase } from './primitives';

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
          className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{ color: severity.color, borderColor: severity.color }}
        >
          {severity.label}
        </span>
        <code className="font-mono text-sm [overflow-wrap:anywhere]">{finding.root}</code>
        <span className="text-xs text-muted-foreground">
          {finding.writes} {finding.writes === 1 ? 'write' : 'writes'} in {finding.batches}{' '}
          {finding.batches === 1 ? 'batch' : 'batches'} · last <Timestamp iso={finding.lastSeen} />
        </span>
      </div>
      <dl className="grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[7rem_minmax(0,1fr)]">
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
        <dt className="text-muted-foreground">Fix</dt>
        <dd>{finding.fix}</dd>
      </dl>
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
    <div role="region" aria-label="Stateless contract">
      <Panel
        title="Stateless contract"
        description="Writes to state-shaped directories seen while the app ran. Anything written to local disk is lost when the instance parks."
        padded={false}
      >
        {phase === 'ready' ? (
          <ul className="divide-y divide-border">
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
        <div className="flex flex-col gap-1 border-t border-border px-5 py-3 text-xs text-muted-foreground">
          {events.length >= ADVISORY_LIMIT && (
            <p>Showing the newest {ADVISORY_LIMIT} batches; older writes are not counted here.</p>
          )}
          <p>
            Gregale watches /data, /db and database directories under /var/lib and reports writes;
            the app keeps running. It is observation of a fixed set of paths, not a guarantee the
            app is stateless. Deploys are checked separately, and a failed check fails the
            deployment. See{' '}
            <a href="/docs/storage" className="text-brand underline underline-offset-4">
              Storage
            </a>
            .
          </p>
        </div>
      </Panel>
    </div>
  );
}
