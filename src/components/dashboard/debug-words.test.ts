import { describe, expect, it } from 'vitest';
import type { DebugStatus } from '@/lib/api/debug';
import {
  describeDebugStatus,
  regressionFigures,
  regressionPhrase,
  slowdown,
  windowWords,
} from './debug-words';

type Regression = DebugStatus['regressions'][number];

const latency: Regression = {
  deployment_id: 'dep-1',
  route: '/orders/{id}',
  kind: 'latency',
  p95_ms: 1840,
  p95_base_ms: 260,
  affected_count: 412,
  regression_factor: '7.08',
  first_detected_at: '2026-11-03T10:00:00Z',
  last_detected_at: '2026-11-03T11:58:00Z',
  state: 'active',
};

const errors: Regression = {
  ...latency,
  route: '/webhooks/stripe',
  kind: 'errors',
  p95_ms: 310,
  p95_base_ms: 300,
  regression_factor: '1.00',
  error_rate_pct: 12.4,
  error_rate_base_pct: 0.2,
};

const status = (over: Partial<DebugStatus> = {}): DebugStatus => ({
  verdict: 'healthy',
  headline: 'apid headline',
  since: '1h',
  window_start: '2026-11-03T11:00:00Z',
  window_end: '2026-11-03T12:00:00Z',
  health: { requests: 1240, server_errors: 0, p95_ms: 182 },
  deployments: [{ id: 'dep-1', traffic_percent: 100, created_at: '2026-11-03T09:00:00Z' }],
  regressions: [],
  regressions_total: 0,
  recent_failures: [],
  tracing_enabled: true,
  generated_at: '2026-11-03T12:00:00Z',
  ...over,
});

describe('windowWords', () => {
  it('says a window the way people do', () => {
    expect(windowWords('1h')).toBe('the last hour');
    expect(windowWords('6h')).toBe('the last 6 hours');
    expect(windowWords('72h')).toBe('the last 3 days');
    expect(windowWords('3d')).toBe('the last 3 days');
    expect(windowWords('30m')).toBe('the last 30 minutes');
    expect(windowWords('1h30m')).toBe('the last 1h30m');
  });
});

describe('regression phrases', () => {
  it('rounds a big slowdown to whole times and keeps one decimal for a small one', () => {
    expect(slowdown(latency)).toBe('7×');
    expect(slowdown({ ...latency, regression_factor: '1.42' })).toBe('1.4×');
    // An unreadable factor falls back to the two p95s.
    expect(slowdown({ ...latency, regression_factor: 'x' })).toBe('7×');
    expect(slowdown({ ...latency, regression_factor: '1.00', p95_base_ms: 0 })).toBeUndefined();
  });

  it('names the route and what got worse', () => {
    expect(regressionPhrase(latency)).toBe('/orders/{id} is 7× slower');
    expect(regressionPhrase(errors)).toBe('/webhooks/stripe fails 12% of the time');
    expect(
      regressionPhrase({ ...errors, kind: 'latency_and_errors', regression_factor: '3.1' })
    ).toBe('/webhooks/stripe is 3× slower and fails 12% of the time');
    // Servers before error detection omit kind: that is latency.
    expect(regressionPhrase({ ...latency, kind: undefined })).toBe('/orders/{id} is 7× slower');
  });

  it('keeps the measured numbers for the details', () => {
    expect(regressionFigures(latency)).toBe('95% within 1,840 ms (was 260 ms)');
    expect(regressionFigures(errors)).toBe('12% server errors (was 0.2%)');
  });
});

describe('describeDebugStatus', () => {
  it('names the routes that got worse in the serving release and points at their requests', () => {
    const words = describeDebugStatus(
      status({ verdict: 'degraded', regressions: [latency, errors], regressions_total: 2 })
    );
    expect(words.sentence).toBe(
      '2 routes got worse in the serving release: /orders/{id} is 7× slower and /webhooks/stripe fails 12% of the time.'
    );
    expect(words.tone).toBe('warning');
    expect(words.action?.label).toBe('Look at the affected requests');
    expect(words.action?.patch).toMatchObject({
      debugView: 'requests',
      debugFilter: 'regressions',
    });
  });

  it('does not claim the serving release for a regression on another deployment', () => {
    const words = describeDebugStatus(
      status({
        verdict: 'degraded',
        regressions: [{ ...latency, deployment_id: 'dep-old' }],
        regressions_total: 1,
      })
    );
    expect(words.sentence).toBe('1 route got worse in the last hour: /orders/{id} is 7× slower.');
  });

  it('counts regressions, not routes, when the list is cut short', () => {
    const words = describeDebugStatus(
      status({ verdict: 'degraded', regressions: [latency, errors], regressions_total: 7 })
    );
    expect(words.sentence).toBe(
      '7 regressions are open in the serving release: /orders/{id} is 7× slower, /webhooks/stripe fails 12% of the time and 5 others.'
    );
  });

  it('says a failing app’s server errors and offers the failed requests', () => {
    const words = describeDebugStatus(
      status({ verdict: 'failing', health: { requests: 400, server_errors: 120, p95_ms: 90 } })
    );
    expect(words.sentence).toBe('120 of 400 requests failed with a server error in the last hour.');
    expect(words.tone).toBe('critical');
    expect(words.action?.patch).toMatchObject({ debugFilter: 'failed' });
  });

  it('puts out-of-memory first and sends the reader to the fix', () => {
    const words = describeDebugStatus(
      status({
        verdict: 'degraded',
        oom_kills_total: 2,
        oom_kills: [
          {
            at: '2026-11-03T11:50:02Z',
            deployment_id: 'dep-1',
            peak_mb: 600,
            plan_mb: 512,
            deployment_failed: false,
          },
        ],
        oom_fix: '• upgrade',
        regressions: [latency],
        regressions_total: 1,
      })
    );
    expect(words.sentence).toBe(
      'The app ran out of memory 2 times in the last hour. The latest needed 600 MB on a 512 MB plan.'
    );
    expect(words.action).toEqual({ label: 'See what to do', details: true });
  });

  it('says healthy and idle plainly, with nothing to do', () => {
    const healthy = describeDebugStatus(status());
    expect(healthy.sentence).toBe(
      'Healthy: 1,240 requests in the last hour, no server errors, 95% answered within 182 ms.'
    );
    expect(healthy.action).toBeUndefined();
    expect(
      describeDebugStatus(
        status({ verdict: 'idle', health: { requests: 0, server_errors: 0, p95_ms: 0 } })
      ).sentence
    ).toBe('No requests in the last hour.');
  });

  it('uses apid’s own rollout words for a release or a rollback', () => {
    const rollout = {
      state: 'aborted',
      headline: 'The release was rolled back after its checks failed.',
    } as DebugStatus['rollout'];
    expect(describeDebugStatus(status({ verdict: 'rolled_back', rollout })).sentence).toBe(
      'The release was rolled back after its checks failed.'
    );
    expect(describeDebugStatus(status({ verdict: 'releasing' })).sentence).toBe('apid headline');
  });

  it('falls back to apid’s headline for a verdict this console does not know', () => {
    const words = describeDebugStatus(status({ verdict: 'new' as DebugStatus['verdict'] }));
    expect(words).toEqual({ tone: 'idle', sentence: 'apid headline' });
  });
});
