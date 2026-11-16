import { expect, it } from 'vitest';
import {
  clearDetailSearch,
  detailRequest,
  detailSearch,
  validateMetricDetailSearch,
} from './metric-detail-search';

it('limits account URL windows to the selected snapshot endpoint contract', () => {
  expect(
    validateMetricDetailSearch({ inspect: 'requests', inspectSource: 'slo', inspectSince: '5m' })
      .inspectSince
  ).toBe('24h');
  expect(
    validateMetricDetailSearch({
      inspect: 'requests',
      inspectSince: '2026-11-01T00:00:00Z',
      inspectUntil: '2026-11-02T00:00:00Z',
    })
  ).toEqual({ inspect: 'requests', inspectSince: '24h', inspectSource: 'rollup' });
});

it.each(['GET', 'OTHER'] as const)(
  'roundtrips a shareable %s route and exact UTC window',
  (method) => {
    const request = {
      metric: 'p95',
      app: 'api-gateway',
      since: '2026-11-01T00:00:00Z',
      until: '2026-11-02T00:00:00Z',
      route: '/orders',
      method,
      group: 'route',
      source: 'rollup',
    } as const;
    expect(detailRequest(validateMetricDetailSearch(detailSearch(request)))).toEqual(request);
  }
);

it('rejects unknown metrics, unsafe slugs, unpaired routes and timezone-less bounds', () => {
  expect(validateMetricDetailSearch({ inspect: 'made-up' })).toEqual({});
  expect(
    validateMetricDetailSearch({
      inspect: 'requests',
      inspectApp: '../admin',
      inspectSince: '2026-11-01T12:00:00',
      inspectUntil: 'nonsense',
      inspectRoute: '/orders',
    })
  ).toEqual({ inspect: 'requests', inspectSince: '24h', inspectSource: 'rollup' });
  expect(
    validateMetricDetailSearch({
      inspect: 'requests',
      inspectSince: '2026-11-02T00:00:00Z',
      inspectUntil: '2026-11-01T00:00:00Z',
    }).inspectUntil
  ).toBeUndefined();
});

it('closing removes only detail keys and preserves the underlying page filters', () => {
  expect(
    clearDetailSearch({
      ...detailSearch({ metric: 'requests', app: 'api', since: '7d' }),
      tab: 'Metrics',
      analyticsSince: '7d',
      analyticsGroup: 'country',
      q: 'checkout',
      inspectionNote: 'keep',
    })
  ).toEqual({
    tab: 'Metrics',
    analyticsSince: '7d',
    analyticsGroup: 'country',
    q: 'checkout',
    inspectionNote: 'keep',
  });
});
