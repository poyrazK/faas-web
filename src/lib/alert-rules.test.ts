import { describe, expect, it } from 'vitest';
import {
  ALERT_METRICS,
  EMPTY_RULE_DRAFT,
  MAX_CHANNELS_PER_RULE,
  channelDraftErrors,
  comparisonsFor,
  logQueryProblem,
  ruleDraftBody,
  ruleDraftErrors,
  windowsFor,
  type RuleDraft,
} from './alert-rules';

const draft = (patch: Partial<RuleDraft>): RuleDraft => ({
  ...EMPTY_RULE_DRAFT,
  name: 'Errors',
  webhookUrl: 'https://hooks.example.com/a',
  webhookSecret: 's3cret',
  ...patch,
});

describe('ALERT_METRICS', () => {
  it('offers the app metrics a rule can watch without a selector the form lacks', () => {
    const values = ALERT_METRICS.map((m) => m.value);
    expect(values).toEqual(
      expect.arrayContaining([
        'error_rate_pct',
        'failed_invocations',
        'api_up',
        'queue_backlog',
        'log_error_lines',
        'log_search_matches',
        'slo_budget_burn',
        'slo_budget_remaining_pct',
        'synthetic_check_consecutive_failures',
        'synthetic_check_latency_p95_ms',
        'route_monitor_incidents',
        'custom_metric',
      ])
    );
    expect(values.length).toBeGreaterThanOrEqual(24);
    // Selectors this form does not have (event subscriptions, MCP scopes).
    expect(values).not.toContain('event_pending_recipients');
    expect(values).not.toContain('mcp_readiness_unhealthy');
    expect(new Set(values).size).toBe(values.length);
  });

  it('names the capability apid checks for gated metrics (pkg/api/alerts.go)', () => {
    const cap = (v: string) => ALERT_METRICS.find((m) => m.value === v)?.capability;
    expect(cap('log_search_matches')).toBe('log-search');
    expect(cap('slo_budget_burn')).toBe('custom-slos');
    expect(cap('synthetic_check_latency_p95_ms')).toBe('synthetic-checks');
    expect(cap('route_health_holds')).toBe('route-health-canary-guard');
    expect(cap('custom_metric')).toBe('custom-metric-history');
    expect(cap('error_rate_pct')).toBeUndefined();
  });
});

describe('windowsFor / comparisonsFor', () => {
  it('limits log search, custom metric and route rules to a day', () => {
    expect(windowsFor('log_search_matches')).toEqual(['5m', '15m', '1h', '6h', '24h']);
    expect(windowsFor('custom_metric')).not.toContain('7d');
    expect(windowsFor('route_monitor_incidents')).not.toContain('15d');
    expect(windowsFor('error_rate_pct')).toContain('15d');
  });

  it('offers baselines only where ADR-744 allows and only when released', () => {
    expect(comparisonsFor('error_rate_pct', false)).toEqual(['gt', 'gte', 'lt', 'lte']);
    expect(comparisonsFor('error_rate_pct', true)).toContain('above_baseline');
    expect(comparisonsFor('error_rate_pct', true)).not.toContain('below_baseline');
    expect(comparisonsFor('request_count', true)).toContain('below_baseline');
    expect(comparisonsFor('latency_p50_ms', true)).not.toContain('above_baseline');
  });
});

describe('ruleDraftErrors', () => {
  it('accepts a webhook rule', () => {
    expect(ruleDraftErrors(draft({}))).toEqual({});
  });

  it('needs a destination: a webhook with its secret, or a channel', () => {
    const none = ruleDraftErrors(draft({ webhookUrl: '', webhookSecret: '' }));
    expect(none.webhookUrl).toMatch(/webhook or choose a channel/i);
    expect(
      ruleDraftErrors(draft({ webhookUrl: '', webhookSecret: '', channelIds: ['c1'] }))
    ).toEqual({});
    expect(ruleDraftErrors(draft({ webhookSecret: '' })).secret).toMatch(/secret/i);
    expect(ruleDraftErrors(draft({ webhookUrl: '' })).webhookUrl).toMatch(/HTTPS/);
    expect(ruleDraftErrors(draft({ webhookUrl: 'http://x.example' })).webhookUrl).toMatch(/HTTPS/);
  });

  it('caps the secret at 256 bytes, not characters', () => {
    expect(ruleDraftErrors(draft({ webhookSecret: 'é'.repeat(129) })).secret).toBeDefined();
    expect(ruleDraftErrors(draft({ webhookSecret: 'e'.repeat(256) })).secret).toBeUndefined();
  });

  it('caps channels at five', () => {
    const ids = Array.from({ length: MAX_CHANNELS_PER_RULE + 1 }, (_, i) => `c${i}`);
    expect(ruleDraftErrors(draft({ channelIds: ids })).channels).toMatch(/5/);
  });

  it('bounds the name, threshold and cooldown as apid does', () => {
    expect(ruleDraftErrors(draft({ name: '  ' })).name).toBeDefined();
    expect(ruleDraftErrors(draft({ name: 'x'.repeat(65) })).name).toMatch(/64/);
    expect(ruleDraftErrors(draft({ threshold: '' })).threshold).toBeDefined();
    expect(ruleDraftErrors(draft({ cooldown: '4' })).cooldown).toBeDefined();
    expect(ruleDraftErrors(draft({ cooldown: '1441' })).cooldown).toBeDefined();
    expect(ruleDraftErrors(draft({ cooldown: '7.5' })).cooldown).toBeDefined();
  });

  it('bounds baseline multipliers (pkg/api/alerts.go ValidateAnomalyAlertRule)', () => {
    const above = (t: string) =>
      ruleDraftErrors(draft({ comparison: 'above_baseline', threshold: t })).threshold;
    expect(above('1.4')).toMatch(/1\.5/);
    expect(above('3')).toBeUndefined();
    expect(above('21')).toBeDefined();
    const below = (t: string) =>
      ruleDraftErrors(
        draft({ metric: 'request_count', comparison: 'below_baseline', threshold: t })
      ).threshold;
    expect(below('0.3')).toBeUndefined();
    expect(below('0.7')).toMatch(/0\.05/);
  });

  it('requires the selector each metric names', () => {
    expect(ruleDraftErrors(draft({ metric: 'slo_budget_burn' })).sloId).toBeDefined();
    expect(ruleDraftErrors(draft({ metric: 'slo_budget_burn', sloId: 's1' }))).toEqual({});
    expect(
      ruleDraftErrors(draft({ metric: 'synthetic_check_consecutive_failures' })).syntheticCheckId
    ).toBeDefined();
    expect(
      ruleDraftErrors(draft({ metric: 'log_search_matches', window: '15m' })).logQuery
    ).toBeDefined();
    expect(
      ruleDraftErrors(draft({ metric: 'custom_metric', window: '15m', customMetricName: 'Orders' }))
        .customMetricName
    ).toBeDefined();
  });

  it('refuses a window the metric cannot use', () => {
    expect(
      ruleDraftErrors(draft({ metric: 'log_search_matches', logQuery: 'q=x', window: '7d' })).window
    ).toMatch(/24h/);
  });
});

describe('logQueryProblem', () => {
  it('takes log search filters only (state.LogQueryKeys)', () => {
    expect(logQueryProblem('source=runtime&level=error&q=database')).toBeNull();
    expect(logQueryProblem('')).toMatch(/filter/i);
    expect(logQueryProblem('host=x')).toMatch(/host/);
    expect(logQueryProblem('q=a&q=b')).toMatch(/once/);
    expect(logQueryProblem('q=')).toMatch(/filter/i);
  });
});

describe('ruleDraftBody', () => {
  it('sends only the fields the metric uses', () => {
    const body = ruleDraftBody(
      draft({ metric: 'slo_budget_burn', sloId: 's1', syntheticCheckId: 'x', logQuery: 'q=a' })
    );
    expect(body).toMatchObject({ metric: 'slo_budget_burn', slo_id: 's1' });
    expect(body).not.toHaveProperty('synthetic_check_id');
    expect(body).not.toHaveProperty('log_query');
    expect(body).not.toHaveProperty('failure_source');
    expect(body).not.toHaveProperty('channel_ids');
  });

  it('leaves the webhook out of a channel-only rule', () => {
    const body = ruleDraftBody(draft({ webhookUrl: '', webhookSecret: '', channelIds: ['c1'] }));
    expect(body).toMatchObject({ channel_ids: ['c1'] });
    expect(body).not.toHaveProperty('webhook_url');
    expect(body).not.toHaveProperty('webhook_secret');
  });

  it('sends the failure source with failed invocations', () => {
    expect(
      ruleDraftBody(draft({ metric: 'failed_invocations', failureSource: 'inbound_webhook' }))
    ).toMatchObject({ failure_source: 'inbound_webhook' });
  });
});

describe('channelDraftErrors', () => {
  const base = {
    name: 'ops-slack',
    kind: 'slack' as const,
    slackUrl: '',
    routingKey: '',
    region: 'us' as const,
    email: '',
  };

  it('checks the name pattern (api/notification_channels.go)', () => {
    expect(channelDraftErrors({ ...base, name: 'Ops' }, 'me@x.dev').name).toBeDefined();
    expect(channelDraftErrors({ ...base, name: '9ops' }, 'me@x.dev').name).toBeDefined();
  });

  it('takes only a Slack incoming webhook', () => {
    const slack = (slackUrl: string) =>
      channelDraftErrors({ ...base, slackUrl }, 'me@x.dev').slackUrl;
    expect(slack('https://hooks.slack.com/services/T0/B0/abc')).toBeUndefined();
    expect(slack('https://hooks.slack.com/services/T0/B0')).toBeDefined();
    expect(slack('https://evil.example/services/T0/B0/abc')).toBeDefined();
    expect(slack('https://hooks.slack.com/services/T0/B0/abc?x=1')).toBeDefined();
  });

  it('takes a 32-character routing key', () => {
    const pd = (routingKey: string) =>
      channelDraftErrors({ ...base, kind: 'pagerduty', routingKey }, 'me@x.dev').routingKey;
    expect(pd('a'.repeat(32))).toBeUndefined();
    expect(pd('a'.repeat(31))).toMatch(/32/);
  });

  it("sends email only to the account's own address", () => {
    const email = (value: string) =>
      channelDraftErrors({ ...base, kind: 'email', email: value }, 'Me@X.dev').email;
    expect(email('me@x.dev')).toBeUndefined();
    expect(email('other@x.dev')).toMatch(/own/);
  });
});
