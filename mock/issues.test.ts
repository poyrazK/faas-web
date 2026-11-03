import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { components } from '../src/lib/api/schema';
import * as db from './data';
import * as m from './issues';

type Issue = components['schemas']['Issue'];
const slug = db.apps[0].slug;
const other = db.apps[1].slug;
const issue = (over: Partial<Issue> = {}): Issue => ({
  id: randomUUID(),
  app_id: db.apps[0].id,
  environment: 'production',
  fingerprint: 'f',
  grouping_version: 1,
  title: 'PaymentError',
  state: 'open',
  first_seen_at: db.iso(3_600_000),
  last_seen_at: db.iso(60_000),
  event_count: 30,
  regression_count: 1,
  impact_24h: { identified_customers: 2, observed_events: 25, unattributed_events: 0 },
  ...over,
});
const body = (a: m.Answer) => {
  if (m.isProblem(a)) throw new Error(`${a.code}: ${a.detail}`);
  return a.body as Record<string, unknown>;
};
const rule = {
  key: 'burst',
  enabled: true,
  environment: '',
  minimum_events: 50,
  window_seconds: 300,
  cooldown_seconds: 1800,
};

it('replaces frequency rules against the revision and refuses a stale one with its code', () => {
  const start = body(m.getFrequency(slug));
  expect(start.revision).toBe(1);
  const saved = body(m.putFrequency(slug, { expected_revision: 1, rules: [rule] }));
  expect(saved).toEqual({ revision: 2, rules: [rule] });
  expect(m.putFrequency(slug, { expected_revision: 1, rules: [] })).toMatchObject({
    status: 409,
    code: 'issue_frequency_alert_revision_conflict',
  });
  expect(
    m.putFrequency(slug, { expected_revision: 2, rules: [{ ...rule, window_seconds: 30 }] })
  ).toMatchObject({
    status: 400,
  });
});

it('keeps the lifecycle revision for an identical write and previews a draft', () => {
  const draft = { environments: ['production'], cooldown_seconds: 1800 };
  expect(body(m.putLifecycle(other, { expected_revision: 0, ...draft })).revision).toBe(1);
  expect(body(m.putLifecycle(other, { expected_revision: 1, ...draft })).revision).toBe(1);
  expect(m.putLifecycle(other, { expected_revision: 0, ...draft })).toMatchObject({
    code: 'issue_lifecycle_alert_policy_changed',
  });
  const i = issue();
  expect(body(m.previewLifecycle(other, i, { event: 'regressed', ...draft }))).toMatchObject({
    allowed: false,
    reason: 'cooldown',
  });
  expect(
    body(
      m.previewLifecycle(other, i, {
        event: 'created',
        environments: ['staging'],
        cooldown_seconds: 0,
      })
    )
  ).toMatchObject({ reason: 'environment_excluded' });
  expect(
    body(m.previewLifecycle(other, i, { event: 'created', environments: [], cooldown_seconds: 0 }))
  ).toMatchObject({ allowed: true, reason: 'eligible' });
});

it('previews a compound rule predicate by predicate', () => {
  const r = { ...rule, minimum_events: 20, minimum_customers: 3 };
  expect(body(m.previewCompound(other, issue(), { rule: r }))).toMatchObject({
    observed_events: 25,
    identified_customers: 2,
    events_matched: true,
    customers_matched: false,
    reason: 'customer_threshold',
  });
  expect(body(m.previewCompound(other, issue({ state: 'ignored' }), { rule: r })).reason).toBe(
    'suppressed'
  );
  expect(m.putCompound(other, { expected_revision: 0, rules: [rule] })).toMatchObject({
    status: 400,
  });
});

it('saves, replaces and deletes views, and refuses a team with an assignee', () => {
  const team = randomUUID();
  expect(
    m.putView(other, 'mine', { name: 'Mine', filters: { team, assignee: 'me' } })
  ).toMatchObject({
    status: 400,
  });
  body(m.putView(other, 'mine', { name: 'Mine', filters: { assignee: 'me' } }));
  body(
    m.putView(other, 'mine', { name: 'Mine (open)', filters: { assignee: 'me', state: 'open' } })
  );
  const items = body(m.listViews(other)).items as { key: string; name: string }[];
  expect(items).toEqual([expect.objectContaining({ key: 'mine', name: 'Mine (open)' })]);
  expect(m.deleteView(other, 'mine')).toEqual({ status: 204 });
  for (let i = 0; i < 20; i++) body(m.putView(other, `v${i}`, { name: `v${i}`, filters: {} }));
  expect(m.putView(other, 'v20', { name: 'v20', filters: {} })).toMatchObject({
    code: 'issue_quota_exceeded',
  });
});

it('publishes one immutable manifest per deployment, retires it, and restores only the same one', () => {
  const dep = randomUUID();
  const manifest = {
    version: 1,
    artifacts: [{ generatedFile: 'a.js', sha256: 'a'.repeat(64), payload: '{}' }],
  };
  expect(m.getMaps(dep)).toMatchObject({ status: 404, code: 'not_found' });
  const out = body(m.publishMaps(other, dep, { directory: '/app/dist', manifest }));
  expect(out).toMatchObject({ deployment_id: dep, map_count: 1, ready: true });
  expect(out).not.toHaveProperty('app');
  const changed = { ...manifest, artifacts: [{ ...manifest.artifacts[0], payload: '{"x":1}' }] };
  expect(m.publishMaps(other, dep, { directory: '/app/dist', manifest: changed })).toMatchObject({
    code: 'issue_source_maps_conflict',
  });
  expect(body(m.retireMaps(dep))).toMatchObject({ ready: false, retired_at: expect.any(String) });
  expect(m.publishMaps(other, dep, { directory: '/app/dist', manifest: changed })).toMatchObject({
    code: 'issue_source_maps_conflict',
  });
  expect(body(m.publishMaps(other, dep, { directory: '/app/dist', manifest }))).toMatchObject({
    ready: true,
    manifest_sha256: out.manifest_sha256,
  });
  expect(m.publishMaps(other, dep, { directory: 'dist', manifest })).toMatchObject({ status: 400 });
});

it('connects Linear without ever echoing the key, and fences on the revision', () => {
  const team = randomUUID();
  const key = 'lin_api_secret_value';
  expect(
    m.putConnection(other, {
      connected: true,
      expected_revision: 0,
      team_id: team,
      api_key: 'nope',
    })
  ).toMatchObject({
    code: 'issue_tracker_linear_verification_failed',
  });
  const out = body(
    m.putConnection(other, { connected: true, expected_revision: 0, team_id: team, api_key: key })
  );
  expect(out).toMatchObject({
    connected: true,
    revision: 1,
    team_id: team,
    auth_method: 'api_key',
  });
  expect(JSON.stringify(out)).not.toContain(key);
  expect(m.putConnection(other, { connected: false, expected_revision: 0 })).toMatchObject({
    code: 'issue_tracker_linear_connection_changed',
  });
  expect(
    m.putConnection(other, { connected: false, expected_revision: 1, api_key: key })
  ).toMatchObject({
    status: 400,
  });
});

it('links canonical tickets once, and creates Linear tickets idempotently by request ID', () => {
  const i = issue();
  expect(m.canonicalTicket('https://github.com/acme/shop/issues/042?x=1#c')).toEqual({
    provider: 'github',
    key: 'acme/shop#42',
    url: 'https://github.com/acme/shop/issues/42',
  });
  expect(m.canonicalTicket('https://github.com/acme/shop/pull/42')).toBeUndefined();
  const a = body(m.saveLink(i, { url: 'https://linear.app/acme/issue/eng-9/fix-it' }));
  const b = body(m.saveLink(i, { url: 'https://linear.app/acme/issue/ENG-9', title: 'Fix' }));
  expect(b.id).toBe(a.id);
  expect(b.title).toBe('Fix');

  const team = body(m.getConnection(other)).team_id as string;
  const request = randomUUID();
  const create = (over: Record<string, unknown> = {}) =>
    m.createTicket(other, i, { request_id: request, team_id: team, title: 'Fix', ...over });
  const first = body(create());
  expect(first).toMatchObject({ state: 'linked', request_id: request });
  expect(body(create())).toEqual(first);
  expect(create({ title: 'Other' })).toMatchObject({ code: 'issue_tracker_request_conflict' });

  const uncertain = randomUUID();
  const send = (recover?: boolean) =>
    m.createTicket(other, i, {
      request_id: uncertain,
      team_id: team,
      title: 'timeout',
      ...(recover ? { recover } : {}),
    });
  expect(send()).toMatchObject({ code: 'issue_tracker_creation_unconfirmed' });
  expect(send()).toMatchObject({ code: 'issue_tracker_creation_unconfirmed' });
  expect(body(send(true))).toMatchObject({ state: 'linked' });
  expect(
    m.createTicket(slug, i, { request_id: randomUUID(), team_id: team, title: 'x' })
  ).toMatchObject({
    code: 'issue_tracker_connection_required',
  });
});
