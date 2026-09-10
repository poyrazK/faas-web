import type {
  PublicStatusComponent,
  PublicStatusDaily,
  PublicStatusEvent,
  PublicStatusOverview,
  PublicStatusState,
} from '@/lib/api/status';

const stateLabels: Record<PublicStatusState, string> = {
  operational: 'Operational',
  maintenance: 'Maintenance',
  degraded: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  unknown: 'Unknown',
};

const componentLabels: Record<string, string> = {
  api_console: 'API & Console',
  deployments: 'Deployments',
  app_execution: 'App execution',
  networking: 'Networking',
  observability: 'Observability',
};

export function StatusHeader() {
  return (
    <header className="status-header">
      <a href="/status" className="status-wordmark">
        Gregale Status
      </a>
      <nav aria-label="Status navigation">
        <a href="/status#history">Incident history</a>
        <a href="/">Back to Gregale</a>
      </nav>
    </header>
  );
}

export function StatusOverview({
  snapshot,
  updatesDelayed,
}: {
  snapshot: PublicStatusOverview;
  updatesDelayed: boolean;
}) {
  const active = [...snapshot.active_events].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'incident' ? -1 : 1;
    return Date.parse(b.updated_at) - Date.parse(a.updated_at);
  });
  return (
    <div className="status-shell">
      <a href="#status-main" className="skip-link">
        Skip to status
      </a>
      <StatusHeader />
      <main id="status-main" className="status-main">
        {updatesDelayed && (
          <div className="status-delay" role="status">
            <span aria-hidden="true">!</span> Updates delayed — showing the last available snapshot.
          </div>
        )}
        <section className="status-overall" aria-labelledby="overall-title">
          <p className="status-kicker">Current platform status</p>
          <div className="status-overall-line">
            <span
              className={`status-mark status-mark--${snapshot.overall_status}`}
              aria-hidden="true"
            />
            <h1 id="overall-title">{stateLabels[snapshot.overall_status]}</h1>
          </div>
          <p className="status-freshness">
            Data {snapshot.data_status}. Updated{' '}
            <time dateTime={snapshot.updated_at}>{formatDateTime(snapshot.updated_at)}</time>.{' '}
            Gregale currently operates in a single region.
          </p>
        </section>

        {active.length > 0 && (
          <section className="status-section" aria-label="Active incidents and maintenance">
            <SectionHeading eyebrow="Now" title="Active incidents and maintenance" />
            <div className="status-event-list">
              {active.map((item) => (
                <EventCard key={item.id} event={item} />
              ))}
            </div>
          </section>
        )}

        <section className="status-section" aria-labelledby="capabilities-title">
          <SectionHeading
            eyebrow="Last 30 days"
            title="Platform capabilities"
            id="capabilities-title"
          />
          <div className="status-ledger">
            {snapshot.components.map((component) => (
              <CapabilityRow key={component.id} component={component} />
            ))}
          </div>
        </section>

        <section className="status-section" aria-labelledby="indicators-title">
          <SectionHeading
            eyebrow="Current window"
            title="Service indicators"
            id="indicators-title"
          />
          <div className="status-indicators">
            {snapshot.indicators.map((indicator) => (
              <div key={indicator.id} className="status-indicator">
                <span>{indicator.label}</span>
                <strong>
                  {indicator.value === null
                    ? 'No data'
                    : `${formatMetric(indicator.value)}${indicator.unit}`}
                </strong>
                <small>
                  Target {indicator.comparison === 'gte' ? '≥' : '≤'} {indicator.target}
                  {indicator.unit}
                </small>
              </div>
            ))}
          </div>
          <p className="status-note">These are error-budget indicators, not an SLA.</p>
        </section>

        {snapshot.upcoming_maintenance.length > 0 && (
          <section className="status-section" aria-labelledby="maintenance-title">
            <SectionHeading
              eyebrow="Next 30 days"
              title="Upcoming maintenance"
              id="maintenance-title"
            />
            <div className="status-event-list">
              {snapshot.upcoming_maintenance.map((item) => (
                <EventCard key={item.id} event={item} />
              ))}
            </div>
          </section>
        )}

        <section id="history" className="status-section" aria-labelledby="history-title">
          <SectionHeading
            eyebrow="Last 90 days"
            title="Recent incident history"
            id="history-title"
          />
          {snapshot.resolved_incidents.length ? (
            <div className="status-event-list">
              {snapshot.resolved_incidents.map((item) => (
                <EventCard key={item.id} event={item} compact />
              ))}
            </div>
          ) : (
            <p className="status-empty">No resolved incidents in this period.</p>
          )}
        </section>
      </main>
      <StatusFooter />
    </div>
  );
}

function SectionHeading({ eyebrow, title, id }: { eyebrow: string; title: string; id?: string }) {
  return (
    <div className="status-section-heading">
      <p>{eyebrow}</p>
      <h2 id={id}>{title}</h2>
    </div>
  );
}

function CapabilityRow({ component }: { component: PublicStatusComponent }) {
  return (
    <article className="status-capability">
      <div className="status-capability-copy">
        <div>
          <h3>{component.name}</h3>
          <StatusText state={component.status} />
        </div>
        <div className="status-uptime">
          <strong>
            {component.uptime_30d_pct === null
              ? 'Collecting data'
              : `${component.uptime_30d_pct.toFixed(3)}%`}
          </strong>
          <span>{component.coverage_30d_pct.toFixed(0)}% telemetry coverage</span>
        </div>
      </div>
      <div
        className="status-days"
        role="group"
        aria-label={`${component.name} 30-day status history`}
      >
        {component.daily.map((day) => (
          <DayBar key={day.date} day={day} />
        ))}
      </div>
    </article>
  );
}

function DayBar({ day }: { day: PublicStatusDaily }) {
  const uptime = day.uptime_pct === null ? 'No data' : `${day.uptime_pct.toFixed(3)}% uptime`;
  const label = `${day.date}: ${stateLabels[day.status]}. ${uptime}. ${day.coverage_pct.toFixed(0)}% telemetry coverage.`;
  return (
    <span
      className={`status-day status-day--${day.status}`}
      tabIndex={0}
      role="img"
      aria-label={label}
      title={label}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}

function StatusText({ state }: { state: PublicStatusState }) {
  return (
    <span className={`status-text status-text--${state}`}>
      <span className="status-text-symbol" aria-hidden="true">
        {stateSymbol(state)}
      </span>
      {stateLabels[state]}
    </span>
  );
}

function EventCard({ event, compact = false }: { event: PublicStatusEvent; compact?: boolean }) {
  const latest = event.updates[event.updates.length - 1];
  const when = event.scheduled_start_at ?? event.starts_at ?? event.updated_at;
  return (
    <article className="status-event" data-kind={event.kind}>
      <div className="status-event-meta">
        <span>{event.kind === 'incident' ? 'Incident' : 'Maintenance'}</span>
        <time dateTime={when}>{formatDateTime(when)}</time>
      </div>
      <h3>
        <a href={`/status/incidents/${event.id}`}>{event.title}</a>
      </h3>
      <p className="status-event-state">
        {humanize(event.state)} ·{' '}
        {event.components.map((id) => componentLabels[id] ?? id).join(', ')}
      </p>
      {!compact && latest && <p>{latest.message}</p>}
    </article>
  );
}

export function IncidentDetail({ event }: { event: PublicStatusEvent }) {
  const ordered = [...event.updates].sort(
    (a, b) => Date.parse(a.posted_at) - Date.parse(b.posted_at)
  );
  return (
    <div className="status-shell">
      <StatusHeader />
      <main className="status-main status-detail">
        <a href="/status" className="status-back">
          ← Status overview
        </a>
        <p className="status-kicker">
          {event.kind === 'incident' ? 'Incident' : 'Maintenance'} · {humanize(event.state)}
        </p>
        <h1>{event.title}</h1>
        <p className="status-detail-components">
          Affected: {event.components.map((id) => componentLabels[id] ?? id).join(', ')}
        </p>
        <ol className="status-timeline" aria-label="Incident timeline">
          {ordered.map((update) => (
            <li key={update.id}>
              <time dateTime={update.posted_at}>{formatDateTime(update.posted_at)}</time>
              <div>
                <strong>{humanize(update.state)}</strong>
                <p>{update.message}</p>
              </div>
            </li>
          ))}
        </ol>
      </main>
      <StatusFooter />
    </div>
  );
}

export function StatusUnavailable() {
  return (
    <div className="status-shell">
      <StatusHeader />
      <main className="status-main status-unavailable">
        <p className="status-kicker">Data source unavailable</p>
        <h1>Status temporarily unavailable</h1>
        <p>We could not load the current snapshot. Please try again shortly.</p>
      </main>
      <StatusFooter />
    </div>
  );
}

export function StatusNotFound() {
  return (
    <div className="status-shell">
      <StatusHeader />
      <main className="status-main status-unavailable">
        <p className="status-kicker">Status event not found</p>
        <h1>This event is unavailable</h1>
        <p>The incident link may be invalid or the event may not have been published.</p>
        <a href="/status" className="status-back">
          ← Status overview
        </a>
      </main>
      <StatusFooter />
    </div>
  );
}

function StatusFooter() {
  return (
    <footer className="status-footer">
      <span>Gregale status</span>
      <span>Single-region service · Error-budget indicators</span>
    </footer>
  );
}
function formatDateTime(value: string) {
  return (
    new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(value)) + ' UTC'
  );
}
function formatMetric(value: number) {
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}
function humanize(value: string) {
  return value.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
function stateSymbol(state: PublicStatusState) {
  if (state === 'operational') return '✓';
  if (state === 'unknown') return '?';
  if (state === 'maintenance') return '◇';
  return '!';
}
