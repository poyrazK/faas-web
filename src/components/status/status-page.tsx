import { CheckCircle, Clock, HelpCircle, NavArrowRight, WarningTriangle } from 'iconoir-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
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

const overallLabels: Record<PublicStatusState, string> = {
  operational: 'All systems operational',
  maintenance: 'Maintenance in progress',
  degraded: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
  unknown: 'Status unavailable',
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
      <div className="status-header-inner">
        <a href="/status" className="status-wordmark" aria-label="Gregale Status home">
          <img src="/favicon.png" alt="" />
          <span>Gregale</span>
          <Separator orientation="vertical" className="status-wordmark-separator" />
          <strong>Status</strong>
        </a>
        <nav aria-label="Status navigation">
          <Button asChild variant="ghost" size="sm" className="status-nav-history">
            <a href="/status#history">History</a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/">Back to Gregale</a>
          </Button>
        </nav>
      </div>
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
            <WarningTriangle aria-hidden="true" />
            <span>
              <strong>Updates delayed.</strong> Showing the last available snapshot.
            </span>
          </div>
        )}

        <section
          className={`status-overall status-overall--${snapshot.overall_status}`}
          aria-label="Current platform status"
        >
          <div className="status-overall-icon" aria-hidden="true">
            <StateIcon state={snapshot.overall_status} />
          </div>
          <div className="status-overall-copy">
            <p>Current platform status</p>
            <h1>{overallLabels[snapshot.overall_status]}</h1>
          </div>
          <div className="status-freshness">
            <strong>{dataStatusLabel(snapshot.data_status)}</strong>
            <span>
              Updated{' '}
              <time dateTime={snapshot.updated_at}>{formatDateTime(snapshot.updated_at)}</time>
            </span>
            <span>Single-region service</span>
          </div>
        </section>

        {active.length > 0 && (
          <section className="status-section" aria-label="Active incidents and maintenance">
            <SectionHeading
              title="Active incidents and maintenance"
              description="Current events that may affect Gregale services."
            />
            <div className="status-event-list status-event-list--active">
              {active.map((item) => (
                <EventCard key={item.id} event={item} />
              ))}
            </div>
          </section>
        )}

        <section className="status-section" aria-labelledby="capabilities-title">
          <SectionHeading
            title="Platform capabilities"
            description="Status, uptime, and telemetry coverage for the last 30 days."
            id="capabilities-title"
          />
          <ul className="status-ledger" aria-label="Platform capabilities">
            {snapshot.components.map((component) => (
              <CapabilityRow key={component.id} component={component} />
            ))}
          </ul>
        </section>

        <section className="status-section" aria-labelledby="indicators-title">
          <SectionHeading
            title="Service indicators"
            description="Current error-budget measurements across the platform."
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
          <p className="status-note">Measurements are error-budget indicators, not an SLA.</p>
        </section>

        {snapshot.upcoming_maintenance.length > 0 && (
          <section className="status-section" aria-labelledby="maintenance-title">
            <SectionHeading
              title="Upcoming maintenance"
              description="Planned work scheduled within the next 30 days."
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
            title="Recent incident history"
            description="Resolved incidents published during the last 90 days."
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

function SectionHeading({
  title,
  description,
  id,
}: {
  title: string;
  description: string;
  id?: string;
}) {
  return (
    <div className="status-section-heading">
      <h2 id={id}>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function CapabilityRow({ component }: { component: PublicStatusComponent }) {
  return (
    <li className="status-capability">
      <div className="status-capability-copy">
        <div className="status-capability-title">
          <h3>{component.name}</h3>
          <StatusBadge state={component.status} />
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
      <div className="status-days-axis" aria-hidden="true">
        <span>30 days ago</span>
        <span>Today</span>
      </div>
    </li>
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

function StatusBadge({ state }: { state: PublicStatusState }) {
  return (
    <Badge variant="outline" className={`status-badge status-badge--${state}`}>
      <StateIcon state={state} />
      {stateLabels[state]}
    </Badge>
  );
}

function StateIcon({ state }: { state: PublicStatusState }) {
  const className = 'status-state-icon';
  if (state === 'operational') return <CheckCircle className={className} aria-hidden="true" />;
  if (state === 'maintenance') return <Clock className={className} aria-hidden="true" />;
  if (state === 'unknown') return <HelpCircle className={className} aria-hidden="true" />;
  return <WarningTriangle className={className} aria-hidden="true" />;
}

function EventCard({ event, compact = false }: { event: PublicStatusEvent; compact?: boolean }) {
  const latest = event.updates[event.updates.length - 1];
  const when = event.scheduled_start_at ?? event.starts_at ?? event.updated_at;
  return (
    <article
      className={`status-event status-event--${event.kind}`}
      data-kind={event.kind}
      data-impact={event.impact}
    >
      <a
        href={`/status/incidents/${event.id}`}
        className="status-event-link"
        aria-label={`${event.title}: ${humanize(event.state)}. View details.`}
      >
        <div className="status-event-topline">
          <Badge variant="outline" className="status-event-kind">
            {event.kind === 'incident' ? 'Incident' : 'Maintenance'}
          </Badge>
          <time dateTime={when}>{formatDateTime(when)}</time>
        </div>
        <div className="status-event-title">
          <h3>{event.title}</h3>
          <NavArrowRight aria-hidden="true" />
        </div>
        {!compact && latest && <p className="status-event-message">{latest.message}</p>}
        <p className="status-event-state">
          <strong>{humanize(event.state)}</strong>
          <span>{event.components.map((id) => componentLabels[id] ?? id).join(', ')}</span>
        </p>
      </a>
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
        <Button asChild variant="ghost" size="sm" className="status-back">
          <a href="/status">← Status overview</a>
        </Button>
        <section className="status-detail-heading">
          <div className="status-detail-meta">
            <Badge variant="outline">
              {event.kind === 'incident' ? 'Incident' : 'Maintenance'}
            </Badge>
            <Badge variant="secondary">{humanize(event.state)}</Badge>
          </div>
          <h1>{event.title}</h1>
          <p>
            Affected services: {event.components.map((id) => componentLabels[id] ?? id).join(', ')}
          </p>
        </section>
        <section className="status-detail-timeline" aria-labelledby="timeline-title">
          <SectionHeading
            id="timeline-title"
            title="Event timeline"
            description="Updates are shown in chronological order."
          />
          <ol className="status-timeline" aria-label="Incident timeline">
            {ordered.map((update) => (
              <li key={update.id}>
                <div className="status-timeline-marker" aria-hidden="true" />
                <div>
                  <div className="status-timeline-heading">
                    <strong>{humanize(update.state)}</strong>
                    <time dateTime={update.posted_at}>{formatDateTime(update.posted_at)}</time>
                  </div>
                  <p>{update.message}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
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
        <div className="status-unavailable-icon" aria-hidden="true">
          <WarningTriangle />
        </div>
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
        <div className="status-unavailable-icon" aria-hidden="true">
          <HelpCircle />
        </div>
        <h1>This event is unavailable</h1>
        <p>The incident link may be invalid or the event may not have been published.</p>
        <Button asChild variant="outline" size="sm" className="status-unavailable-action">
          <a href="/status">Back to status overview</a>
        </Button>
      </main>
      <StatusFooter />
    </div>
  );
}

function StatusFooter() {
  return (
    <footer className="status-footer">
      <span>Gregale Status</span>
      <span>Single-region service · Error-budget indicators</span>
    </footer>
  );
}

function dataStatusLabel(status: PublicStatusOverview['data_status']) {
  if (status === 'fresh') return 'Live telemetry';
  if (status === 'stale') return 'Telemetry delayed';
  return 'Telemetry unavailable';
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
