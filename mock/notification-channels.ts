import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
export type Channel = S['NotificationChannelResponse'];

/** apid's MaxNotificationChannelsPerAccount and MaxChannelsPerAlertRule. */
export const MAX_CHANNELS = 10;
export const MAX_PER_RULE = 5;

/**
 * Seeded channels: a Slack channel that delivers, a PagerDuty one whose last
 * test failed (so the "Failing" state is visible), and the account's email.
 * MOCK_EMPTY=1 starts with none.
 */
export const channels: Channel[] = db.EMPTY
  ? []
  : [
      {
        id: randomUUID(),
        name: 'ops-slack',
        kind: 'slack',
        target: 'hooks.slack.com · T04ABCD/B07WXYZ',
        last_delivered_at: db.iso(3 * 3_600_000),
        created_at: db.iso(20 * 86_400_000),
      },
      {
        id: randomUUID(),
        name: 'oncall',
        kind: 'pagerduty',
        target: 'routing key …9f2c',
        pagerduty_region: 'eu',
        last_delivered_at: db.iso(4 * 86_400_000),
        last_error: 'PagerDuty returned 400: invalid routing key',
        last_error_at: db.iso(2 * 3_600_000),
        created_at: db.iso(12 * 86_400_000),
      },
      {
        id: randomUUID(),
        name: 'me',
        kind: 'email',
        target: db.account.email,
        created_at: db.iso(6 * 86_400_000),
      },
    ];

/** Thrown as a problem by the plugin. */
export class ChannelProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string
  ) {
    super(detail);
  }
}

const NAME = /^[a-z][a-z0-9_-]{0,62}$/;

/** POST /v1/notification-channels, validated as apid does (notification_channels.go:56-82). */
export function createChannel(body: Record<string, unknown>): Channel {
  const name = String(body.name ?? '');
  const kind = String(body.kind ?? '');
  const invalid = (detail: string) =>
    new ChannelProblem(400, 'notification_channel_invalid', detail);
  if (!NAME.test(name)) throw invalid('name must match [a-z][a-z0-9_-]{0,62}');
  if (channels.some((c) => c.name === name))
    throw new ChannelProblem(
      409,
      'notification_channel_invalid',
      'this account already has a notification channel with that name'
    );
  if (channels.length >= MAX_CHANNELS)
    throw new ChannelProblem(
      422,
      'notification_channel_limit_reached',
      `an account can have at most ${MAX_CHANNELS} notification channels; delete one to add another`
    );
  const base = { id: randomUUID(), name, created_at: new Date().toISOString() };
  if (kind === 'slack') {
    const url = String(body.slack_webhook_url ?? '');
    if (!url.startsWith('https://hooks.slack.com/services/') || body.pagerduty_routing_key)
      throw invalid('a slack channel takes a hooks.slack.com/services URL only');
    const parts = url.split('/').slice(4, 6).join('/');
    const channel: Channel = { ...base, kind, target: `hooks.slack.com · ${parts}` };
    channels.push(channel);
    return channel;
  }
  if (kind === 'pagerduty') {
    const key = String(body.pagerduty_routing_key ?? '');
    if (!/^[A-Za-z0-9]{32}$/.test(key) || body.slack_webhook_url)
      throw invalid('a pagerduty channel takes a 32-character routing key');
    const region = body.pagerduty_region === 'eu' ? 'eu' : 'us';
    const channel: Channel = {
      ...base,
      kind,
      target: `routing key …${key.slice(-4)}`,
      pagerduty_region: region,
    };
    channels.push(channel);
    return channel;
  }
  if (kind === 'email') {
    if (String(body.email ?? '').toLowerCase() !== db.account.email.toLowerCase())
      throw invalid(
        "email channels can only send to this account's own email address; other recipients need a confirmation flow that is not available yet"
      );
    const channel: Channel = { ...base, kind, target: db.account.email };
    channels.push(channel);
    return channel;
  }
  throw invalid('kind must be slack, pagerduty or email');
}

/** Rules that would deliver nowhere without this channel (apid's 409 check). */
export function rulesOnlyOn(
  channelId: string,
  rules: S['AlertRuleResponse'][]
): S['AlertRuleResponse'][] {
  return rules.filter(
    (r) => !r.webhook_url && (r.channel_ids ?? []).length === 1 && r.channel_ids?.[0] === channelId
  );
}

/** A test send: the PagerDuty seed keeps failing, everything else delivers. */
export function testChannel(channel: Channel): S['TestNotificationChannelResponse'] {
  const now = new Date().toISOString();
  if (channel.kind === 'pagerduty' && channel.name === 'oncall') {
    channel.last_error = 'PagerDuty returned 400: invalid routing key';
    channel.last_error_at = now;
    return { delivered: false, error: channel.last_error };
  }
  channel.last_delivered_at = now;
  return { delivered: true };
}

/** One SLO and one synthetic check per app, for slo_id and synthetic_check_id. */
export const slos = new Map<string, S['SLOResponse'][]>(
  db.apps.map((a) => [
    a.slug,
    db.EMPTY
      ? []
      : [
          {
            id: randomUUID(),
            name: 'availability',
            sli: 'availability',
            objective_pct: 99.9,
            window_days: 30,
            created_at: db.iso(9 * 86_400_000),
          },
          {
            id: randomUUID(),
            name: 'fast-pages',
            sli: 'latency',
            latency_threshold_ms: 250,
            objective_pct: 99.5,
            window_days: 7,
            created_at: db.iso(4 * 86_400_000),
          },
        ],
  ])
);

export const checks = new Map<string, S['SyntheticCheckResponse'][]>(
  db.apps.map((a) => [
    a.slug,
    db.EMPTY
      ? []
      : [
          {
            id: randomUUID(),
            name: 'health',
            method: 'GET',
            path: '/healthz',
            url: `https://${a.slug}.gregale.app/healthz`,
            timeout_ms: 10_000,
            interval_seconds: 300,
            enabled: true,
            created_at: db.iso(8 * 86_400_000),
          },
        ],
  ])
);
