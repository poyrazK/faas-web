import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
export type Channel = S['NotificationChannelResponse'];

/** pkg/api/limits.go: MaxNotificationChannelsPerAccount, MaxChannelsPerAlertRule, test sends a minute. */
export const MAX_PER_ACCOUNT = 20;
export const MAX_PER_RULE = 5;
export const TESTS_PER_MINUTE = 10;

const NAME = /^[a-z][a-z0-9_-]{0,62}$/;
const SLACK_PATH = /^\/services\/([A-Za-z0-9]+)\/([A-Za-z0-9]+)\/[A-Za-z0-9]+$/;
const ROUTING_KEY = /^[A-Za-z0-9]{32}$/;

/**
 * Account channels: a healthy Slack channel and a PagerDuty one whose last
 * delivery failed, so both outcomes show. MOCK_EMPTY starts with none.
 */
export const channels: Channel[] = db.EMPTY
  ? []
  : [
      {
        id: randomUUID(),
        name: 'ops-slack',
        kind: 'slack',
        target: 'hooks.slack.com/T024BE7LD/B05AQ1Z2K/…',
        last_delivered_at: db.iso(3 * 3600_000),
        created_at: db.iso(20 * 86400_000),
      },
      {
        id: randomUUID(),
        name: 'oncall',
        kind: 'pagerduty',
        target: '…9f2c',
        pagerduty_region: 'eu',
        last_delivered_at: db.iso(4 * 86400_000),
        last_error: 'PagerDuty answered 400: Invalid routing key',
        last_error_at: db.iso(90 * 60_000),
        created_at: db.iso(12 * 86400_000),
      },
    ];

// The first app's error-rate rule delivers to Slack as well as its webhook.
const firstRule = db.apps[0] && db.alerts.get(db.apps[0].slug)?.[0];
if (firstRule && channels[0]) firstRule.channel_ids = [channels[0].id];

/**
 * apid's refusals for a new channel, as `notification_channel_invalid`
 * reasons (api.NormalizeNotificationChannelRequest, sealChannel, and
 * pkg/alertchannels' Slack and PagerDuty validators). Returns the channel to
 * store, or the reason.
 */
export function channelFrom(body: Record<string, unknown>): Channel | string {
  const name = String(body.name ?? '');
  if (!NAME.test(name)) return 'name must match [a-z][a-z0-9_-]{0,62}';
  const base = { id: randomUUID(), name, created_at: new Date().toISOString() };
  switch (body.kind) {
    case 'slack': {
      let match: RegExpMatchArray | null = null;
      try {
        const u = new URL(String(body.slack_webhook_url ?? ''));
        if (u.protocol === 'https:' && u.host === 'hooks.slack.com' && !u.search && !u.hash)
          match = u.pathname.match(SLACK_PATH);
      } catch {
        match = null;
      }
      if (!match)
        return 'slack_webhook_url must be a Slack incoming webhook (https://hooks.slack.com/services/…)';
      return { ...base, kind: 'slack', target: `hooks.slack.com/${match[1]}/${match[2]}/…` };
    }
    case 'pagerduty': {
      const key = String(body.pagerduty_routing_key ?? '');
      const region = body.pagerduty_region ?? 'us';
      if (!ROUTING_KEY.test(key))
        return 'pagerduty_routing_key must be the 32-character Events API v2 integration key';
      if (region !== 'us' && region !== 'eu') return 'pagerduty_region must be us or eu';
      return { ...base, kind: 'pagerduty', target: `…${key.slice(-4)}`, pagerduty_region: region };
    }
    case 'email': {
      const email = String(body.email ?? '').trim();
      if (email.toLowerCase() !== db.account.email.toLowerCase())
        return "email channels can only send to this account's own email address; other recipients need a confirmation flow that is not available yet";
      return { ...base, kind: 'email', target: db.account.email };
    }
    default:
      return 'kind must be slack, pagerduty or email';
  }
}

const testSends: number[] = [];
/** One of the account's test sends this minute, or false when they are used up. */
export function takeTestSend(now = Date.now()): boolean {
  while (testSends.length && testSends[0] <= now - 60_000) testSends.shift();
  if (testSends.length >= TESTS_PER_MINUTE) return false;
  testSends.push(now);
  return true;
}

/** Every rule on every app, for the channel delete check. */
export function allRules(): S['AlertRuleResponse'][] {
  return [...db.alerts.values()].flat();
}

/** One SLO and one synthetic check on the first app, for SLO and check alerts. */
export const slos = new Map<string, S['SLOResponse'][]>(
  db.apps.slice(0, 1).map((a) => [
    a.slug,
    [
      {
        id: randomUUID(),
        name: 'checkout-availability',
        sli: 'availability',
        objective_pct: 99.9,
        window_days: 30,
        created_at: db.iso(30 * 86400_000),
      },
    ],
  ])
);
export const synthetics = new Map<string, S['SyntheticCheckResponse'][]>(
  db.apps.slice(0, 1).map((a) => [
    a.slug,
    [
      {
        id: randomUUID(),
        name: 'health',
        method: 'GET',
        path: '/healthz',
        url: `https://${a.slug}.gregale.app/healthz`,
        timeout_ms: 5000,
        interval_seconds: 300,
        enabled: true,
        created_at: db.iso(30 * 86400_000),
      },
    ],
  ])
);
