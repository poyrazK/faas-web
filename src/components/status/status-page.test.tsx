import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { IncidentDetail, StatusNotFound, StatusOverview, StatusUnavailable } from './status-page';
import type { PublicStatusEvent, PublicStatusOverview } from '@/lib/api/status';

const states = [
  'operational',
  'maintenance',
  'degraded',
  'partial_outage',
  'major_outage',
] as const;
const componentIDs = [
  'api_console',
  'deployments',
  'app_execution',
  'networking',
  'observability',
] as const;

function event(overrides: Partial<PublicStatusEvent> = {}): PublicStatusEvent {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'incident',
    title: 'API errors',
    impact: 'degraded',
    components: ['api_console'],
    state: 'investigating',
    starts_at: '2026-09-09T10:00:00Z',
    updated_at: '2026-09-09T10:05:00Z',
    updates: [
      {
        id: 'u1',
        state: 'investigating',
        message: '<strong>Not HTML</strong>',
        posted_at: '2026-09-09T10:00:00Z',
      },
    ],
    ...overrides,
  };
}

function snapshot(): PublicStatusOverview {
  return {
    overall_status: 'major_outage',
    data_status: 'fresh',
    updated_at: '2026-09-09T10:05:00Z',
    region_scope: 'single-region',
    components: states.map((status, componentIndex) => ({
      id: componentIDs[componentIndex],
      name: ['API & Console', 'Deployments', 'App execution', 'Networking', 'Observability'][
        componentIndex
      ],
      status,
      uptime_30d_pct: componentIndex === 4 ? null : 99.95,
      coverage_30d_pct: componentIndex === 4 ? 22 : 100,
      daily: Array.from({ length: 30 }, (_, day) => ({
        date: `2026-08-${String(day + 1).padStart(2, '0')}`,
        status: day === 0 ? 'unknown' : status,
        uptime_pct: day === 0 ? null : 100,
        coverage_pct: day === 0 ? 0 : 100,
      })),
    })),
    indicators: [
      {
        id: 'api_availability',
        label: 'API availability',
        value: 99.99,
        unit: '%',
        target: 99.9,
        comparison: 'gte',
      },
      { id: 'wake_p95', label: 'Wake p95', value: 242, unit: 'ms', target: 350, comparison: 'lte' },
      {
        id: 'build_success',
        label: 'Build success',
        value: null,
        unit: '%',
        target: 99,
        comparison: 'gte',
      },
    ],
    active_events: [
      event({ id: 'm1', kind: 'maintenance', title: 'Maintenance underway', state: 'in_progress' }),
      event(),
    ],
    upcoming_maintenance: [
      event({
        id: 'm2',
        kind: 'maintenance',
        title: 'Network maintenance',
        state: 'scheduled',
        scheduled_start_at: '2026-09-12T10:00:00Z',
        scheduled_end_at: '2026-09-12T11:00:00Z',
        starts_at: undefined,
      }),
    ],
    resolved_incidents: [
      event({
        id: 'r1',
        title: 'Build delays',
        state: 'resolved',
        resolved_at: '2026-09-08T12:00:00Z',
      }),
    ],
  };
}

describe('StatusOverview', () => {
  it('presents the snapshot as a status banner followed by one five-service ledger', () => {
    render(<StatusOverview snapshot={snapshot()} updatesDelayed={false} />);

    const banner = screen.getByRole('region', { name: 'Current platform status' });
    expect(
      within(banner).getByRole('heading', { level: 1, name: 'Major outage' })
    ).toBeInTheDocument();
    expect(within(banner).getByText(/Live telemetry/)).toBeInTheDocument();

    const ledger = screen.getByRole('list', { name: 'Platform capabilities' });
    expect(within(ledger).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getAllByText('30 days ago')).toHaveLength(5);
    expect(screen.getAllByText('Today')).toHaveLength(5);
  });

  it('renders the public ledger in order with 30 keyboard-readable days per capability', () => {
    const { container } = render(<StatusOverview snapshot={snapshot()} updatesDelayed />);
    expect(screen.getByRole('heading', { level: 1, name: 'Major outage' })).toBeInTheDocument();
    expect(screen.getByText(/Updates delayed/)).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: /30-day status history/i })).toHaveLength(5);
    expect(container.querySelectorAll('.status-day[tabindex="0"]')).toHaveLength(150);
    for (const group of screen.getAllByRole('group', { name: /30-day status history/i })) {
      expect(within(group).getAllByRole('img')).toHaveLength(30);
    }
    expect(container.querySelector('.status-day')?.getAttribute('aria-label')).toContain('No data');
    expect(screen.getByText('Collecting data')).toBeInTheDocument();
    expect(screen.getAllByText('Operational').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Major outage').length).toBeGreaterThan(0);
  });

  it.each([
    ['operational', 'All systems operational', 'Operational'],
    ['maintenance', 'Maintenance in progress', 'Maintenance'],
    ['degraded', 'Degraded performance', 'Degraded performance'],
    ['partial_outage', 'Partial outage', 'Partial outage'],
    ['major_outage', 'Major outage', 'Major outage'],
    ['unknown', 'Status unavailable', 'Unknown'],
  ] as const)(
    'renders the %s overall state with text, not color alone',
    (state, overallLabel, componentLabel) => {
      const value = snapshot();
      value.overall_status = state;
      value.components[0].status = state;
      render(<StatusOverview snapshot={value} updatesDelayed={false} />);
      expect(screen.getByRole('heading', { level: 1, name: overallLabel })).toBeInTheDocument();
      const component = screen
        .getByRole('heading', { level: 3, name: 'API & Console' })
        .closest('li');
      expect(component).not.toBeNull();
      expect(within(component!).getByText(componentLabel)).toBeInTheDocument();
    }
  );

  it('describes a healthy platform in plain language', () => {
    const value = snapshot();
    value.overall_status = 'operational';
    render(<StatusOverview snapshot={value} updatesDelayed={false} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'All systems operational' })
    ).toBeInTheDocument();
  });

  it('orders active incidents before maintenance and renders messages as plain text', () => {
    render(<StatusOverview snapshot={snapshot()} updatesDelayed={false} />);
    const active = screen.getByRole('region', { name: 'Active incidents and maintenance' });
    const cards = within(active).getAllByRole('article');
    expect(cards[0]).toHaveAttribute('data-kind', 'incident');
    const message = screen.getAllByText('<strong>Not HTML</strong>')[0];
    expect(message.querySelector('strong')).toBeNull();
  });
});

it('renders the initial failure and incident timeline accessibly', () => {
  const { rerender } = render(<StatusUnavailable />);
  expect(
    screen.getByRole('heading', { name: 'Status temporarily unavailable' })
  ).toBeInTheDocument();
  rerender(<IncidentDetail event={event()} />);
  expect(screen.getByRole('heading', { name: 'API errors' })).toBeInTheDocument();
  expect(screen.getByRole('list', { name: 'Incident timeline' })).toBeInTheDocument();
});

it('distinguishes a missing status event from a platform outage', () => {
  render(<StatusNotFound />);
  expect(screen.getByRole('heading', { name: 'This event is unavailable' })).toBeInTheDocument();
  expect(screen.queryByText('Status temporarily unavailable')).not.toBeInTheDocument();
});
