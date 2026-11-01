import { expect, it } from 'vitest';
import { mockCapabilities } from './capabilities';
import { listFor, pushMetric, seriesFor, store } from './custom-metrics';

it('lists custom metrics as a paid Beta capability', () => {
  const paid = mockCapabilities('hobby', []).capabilities.find((c) => c.key === 'custom-metrics');
  const free = mockCapabilities('free', []).capabilities.find((c) => c.key === 'custom-metrics');
  expect(paid).toMatchObject({ maturity: 'beta', enabled: true });
  expect(free).toMatchObject({ enabled: false, unavailable_reason: 'plan_not_entitled' });
});

it('computes staleness from the push time against the 300 s window', () => {
  store.set('t-app', new Map());
  pushMetric('t-app', 'fresh', 3, Date.now() - 60_000);
  pushMetric('t-app', 'old', 4, Date.now() - 600_000);
  const list = listFor('t-app');
  expect(list).toMatchObject({ freshness_seconds: 300, max_metrics: 5 });
  expect(list.metrics.find((m) => m.name === 'fresh')?.stale).toBe(false);
  expect(list.metrics.find((m) => m.name === 'old')?.stale).toBe(true);
});

it('returns about a step’s worth of points per range, and none once the pusher stopped', () => {
  store.set('t-app', new Map());
  pushMetric('t-app', 'live', 10, Date.now());
  const day = seriesFor('t-app', 'live', '24h');
  expect(day).toMatchObject({ range: '24h', step: '15m', source: 'prometheus', kind: 'gauge' });
  expect(day.points?.length).toBeGreaterThan(60);
  expect(seriesFor('t-app', 'live', '1h').step).toBe('1m');
  pushMetric('t-app', 'stopped', 10, Date.now() - 3 * 3600_000);
  const stopped = seriesFor('t-app', 'stopped', '1h');
  expect(stopped.points).toEqual([]);
});
