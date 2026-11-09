import { describe, expect, it } from 'vitest';
import type { AppMetrics, Deployment } from '@/lib/api/queries';
import {
  allClear,
  attentionItems,
  releaseAnswer,
  trafficSentence,
  windowWords,
} from './app-overview-words';

const deployment = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'dep-1',
  app_id: 'app-1',
  status: 'live',
  kind: 'github',
  image_digest: 'sha256:abc',
  created_at: '2026-11-10T10:00:00Z',
  min_instances: 0,
  traffic_percent: 100,
  ...over,
});
const metrics = (over: Partial<AppMetrics> = {}): AppMetrics => ({
  app_id: 'app-1',
  range: '24h',
  source: 'prometheus',
  as_of: '2026-11-10T10:00:00Z',
  request_count: 1000,
  error_rate_pct: 0,
  latency_p50_ms: 10,
  latency_p95_ms: 40,
  latency_p99_ms: 80,
  cold_start_pct: 0,
  wake_p95_ms: 0,
  ...over,
});

describe('windowWords', () => {
  it.each([
    ['1h', 'the last hour'],
    ['24h', 'the last 24 hours'],
    ['1d', 'the last day'],
    ['7d', 'the last 7 days'],
    ['custom', 'the custom window'],
    [undefined, 'this window'],
    ['', 'this window'],
  ])('%s → %s', (range, words) => expect(windowWords(range)).toBe(words));
});

describe('releaseAnswer', () => {
  it('names the live version and its share of traffic', () => {
    expect(releaseAnswer([deployment({ revision: 43 })])?.headline).toBe(
      'v43 is live and serving all traffic.'
    );
    expect(releaseAnswer([deployment({ revision: 43, traffic_percent: 60 })])?.headline).toBe(
      'v43 is live and serving 60% of traffic.'
    );
  });

  it('falls back to the short id when the API gives no revision', () => {
    expect(releaseAnswer([deployment({ id: 'abcdef1234567890' })])?.headline).toBe(
      'abcdef12 is live and serving all traffic.'
    );
  });

  it('leads with a rollout and names who keeps the rest', () => {
    const answer = releaseAnswer([
      deployment({
        id: 'new',
        revision: 44,
        rollout_state: 'rolling_out',
        traffic_percent: 10,
      }),
      deployment({ id: 'old', revision: 43, traffic_percent: 90 }),
    ]);
    expect(answer?.label).toBe('Rolling out');
    expect(answer?.headline).toBe('v44 is rolling out and getting 10% of traffic.');
    expect(answer?.detail).toEqual(['The rest stays on v43.']);
  });

  it('mentions a newer build and other environments without changing the answer', () => {
    const answer = releaseAnswer([
      deployment({ id: 'b', revision: 45, status: 'building', traffic_percent: 0 }),
      deployment({ id: 'c', revision: 44, scope: 'canary' }),
      deployment({ id: 'a', revision: 43 }),
    ]);
    expect(answer?.headline).toBe('v43 is live and serving all traffic.');
    expect(answer?.detail).toEqual(['A newer version is building.', 'v44 is live in canary.']);
  });

  it('says nothing is serving when the newest attempt failed with nothing live', () => {
    const answer = releaseAnswer([deployment({ revision: 2, status: 'failed' })]);
    expect(answer).toMatchObject({
      label: 'Failed',
      tone: 'critical',
      headline: 'The latest version, v2, failed to deploy.',
      detail: ['Nothing is serving traffic.'],
    });
  });

  it('keeps a cancel apart from a failure', () => {
    expect(releaseAnswer([deployment({ revision: 2, status: 'cancelled' })])).toMatchObject({
      label: 'Cancelled',
      tone: 'idle',
    });
  });

  it('is undefined with no deployments', () => {
    expect(releaseAnswer([])).toBeUndefined();
  });
});

describe('attentionItems', () => {
  it('flags a failed newest attempt even while an older version serves', () => {
    const items = attentionItems({
      items: [
        deployment({ id: 'new', revision: 44, status: 'failed', error_why: 'Port not bound.' }),
        deployment({ id: 'old', revision: 43 }),
      ],
      rawState: 'running',
      observed: undefined,
    });
    expect(items).toEqual([
      expect.objectContaining({
        key: 'release',
        sentence: 'v44 failed to deploy. v43 is still serving.',
        detail: 'Port not bound.',
        action: { label: 'Inspect failure', tab: 'Deployments', deploymentId: 'new' },
      }),
    ]);
  });

  it('does not flag a cancelled attempt', () => {
    expect(
      attentionItems({
        items: [deployment({ status: 'cancelled' })],
        rawState: 'running',
        observed: undefined,
      })
    ).toEqual([]);
  });

  it('flags an app error state and request errors, each with one action', () => {
    const items = attentionItems({
      items: [deployment()],
      rawState: 'Crashed',
      observed: metrics({ error_rate_pct: 0.42 }),
    });
    expect(items.map((item) => [item.sentence, item.action.label])).toEqual([
      ['The app is reporting an error.', 'Inspect logs'],
      ['Requests returned errors: 0.42% in the last 24 hours.', 'Inspect errors'],
    ]);
  });

  it('never reads an error rate from a window with no requests', () => {
    expect(
      attentionItems({
        items: [deployment()],
        rawState: 'running',
        observed: metrics({ request_count: 0, error_rate_pct: 5 }),
      })
    ).toEqual([]);
  });
});

describe('allClear', () => {
  it('only vouches for requests when metrics saw traffic', () => {
    expect(
      allClear({ releasesKnown: true, observed: metrics(), metricsAccess: 'available' })
    ).toEqual({ sentence: 'Nothing needs your attention.' });
    expect(
      allClear({
        releasesKnown: true,
        observed: metrics({ request_count: 0 }),
        metricsAccess: 'available',
      }).note
    ).toBe('No requests in the last 24 hours, so request errors can’t be judged.');
    expect(
      allClear({ releasesKnown: true, observed: undefined, metricsAccess: 'available' })
    ).toEqual({
      sentence: 'Nothing flagged so far.',
      note: 'Request errors are unconfirmed without metrics.',
    });
    expect(
      allClear({ releasesKnown: true, observed: undefined, metricsAccess: 'restricted' }).note
    ).toBe('Request errors are tracked on Hobby and above.');
    expect(
      allClear({ releasesKnown: false, observed: metrics(), metricsAccess: 'available' })
    ).toEqual({ sentence: 'No confirmed issues yet.' });
  });
});

describe('trafficSentence', () => {
  it('states the window total and error share', () => {
    expect(trafficSentence({ requests: 6700, error_rate_pct: 1 }, '24h')).toBe(
      '6.7K requests in the last 24 hours; 1.00% returned errors.'
    );
    expect(trafficSentence({ requests: 1, error_rate_pct: 0 }, '1h')).toBe(
      '1 request in the last hour, none returned an error.'
    );
    expect(trafficSentence({ requests: 0, error_rate_pct: 0 }, '7d')).toBe(
      'No requests in the last 7 days.'
    );
  });

  it('says nothing rather than zero when the summary is missing', () => {
    expect(trafficSentence(undefined, '24h')).toBeUndefined();
    expect(trafficSentence({}, '24h')).toBeUndefined();
  });

  it('drops the error share when it was not reported', () => {
    expect(trafficSentence({ requests: 20 }, '')).toBe('20 requests in this window.');
  });
});
