import { describe, expect, it } from 'vitest';
import { RECIPES, buildRecipe, recipeEffect } from './edge-rule-recipes';

const DENY_ALL = { deny: ['0.0.0.0/0', '::/0'] };

describe('buildRecipe', () => {
  it('blocks self-declared bots that are not verified, on @app, in log mode', () => {
    const out = buildRecipe('block-unverified-bots', {});
    expect(out).toEqual({
      ok: true,
      body: {
        match_host: '@app',
        match_path: '/**',
        kind: 'ip',
        action: DENY_ALL,
        match: {
          all: [
            { field: 'ua_family', op: 'eq', value: 'bot' },
            { field: 'verified_bot', op: 'missing' },
          ],
        },
        name: 'Block unverified bots',
        description: 'Created from the block-unverified-bots protection recipe.',
        enabled: true,
        mode: 'log',
      },
    });
  });

  it('enforces immediately only when asked', () => {
    const out = buildRecipe('block-unverified-bots', {}, true);
    expect(out.ok && out.body.mode).toBe('enforce');
  });

  it('turns a per-minute rate into a per-IP throttle', () => {
    const out = buildRecipe('rate-limit-path', { path: '/login', methods: 'post' });
    expect(out.ok && out.body).toMatchObject({
      match_path: '/login',
      match_methods: ['POST'],
      kind: 'throttle',
      action: { requests_per_second: 10 / 60, burst: 10, key_by: 'ip' },
    });
  });

  it('refuses a rate outside 1..6000 and a burst outside 1..1000', () => {
    expect(buildRecipe('rate-limit-path', { per_minute: '0' })).toMatchObject({ ok: false });
    expect(buildRecipe('rate-limit-path', { per_minute: '6001' })).toMatchObject({ ok: false });
    expect(buildRecipe('rate-limit-path', { burst: '1001' })).toMatchObject({ ok: false });
  });

  it('boxes a rate-limited client after 3 refusals, a scanner after 1', () => {
    const limit = buildRecipe('rate-limit-path', { penalty_minutes: '15' });
    expect(limit.ok && limit.body.penalty).toEqual({
      seconds: 900,
      after: 3,
      within_seconds: 60,
    });
    const scan = buildRecipe('block-scanner-paths', { penalty_minutes: '5' });
    expect(scan.ok && scan.body.penalty).toEqual({ seconds: 300, after: 1, within_seconds: 60 });
    expect(buildRecipe('rate-limit-path', { penalty_minutes: '1441' })).toMatchObject({
      ok: false,
    });
  });

  it('denies everyone outside the listed IPs, normalising bare IPs to /32 and /128', () => {
    const out = buildRecipe('allow-ips-only', {
      path: '/admin/**',
      cidrs: '203.0.113.7, 198.51.100.0/24 2001:db8::1',
    });
    expect(out.ok && out.body).toMatchObject({
      match_path: '/admin/**',
      kind: 'ip',
      action: DENY_ALL,
      match: {
        not: {
          field: 'client_ip',
          op: 'cidr',
          values: ['203.0.113.7/32', '198.51.100.0/24', '2001:db8::1/128'],
        },
      },
    });
  });

  it('needs at least one IP and refuses what is not one', () => {
    expect(buildRecipe('allow-ips-only', {})).toEqual({
      ok: false,
      field: 'cidrs',
      message: 'Allowed IPs is required.',
    });
    expect(buildRecipe('allow-ips-only', { cidrs: ' , ' })).toMatchObject({
      ok: false,
      message: 'List at least one IP or CIDR.',
    });
    expect(buildRecipe('allow-ips-only', { cidrs: 'office' })).toMatchObject({
      ok: false,
      field: 'cidrs',
    });
  });

  it('blocks scanner prefixes on every path with a path condition', () => {
    const out = buildRecipe('block-scanner-paths', { paths: '/.env, /.git/' });
    expect(out.ok && out.body).toMatchObject({
      match_path: '/**',
      kind: 'ip',
      match: { field: 'path', op: 'prefix', values: ['/.env', '/.git/'] },
    });
    expect(buildRecipe('block-scanner-paths', { paths: 'env' })).toMatchObject({ ok: false });
  });

  it('challenges unverified clients on a path', () => {
    const out = buildRecipe('challenge-path', { path: '/admin/**' });
    expect(out.ok && out.body).toMatchObject({
      match_path: '/admin/**',
      kind: 'challenge',
      action: {},
      match: { field: 'verified_bot', op: 'missing' },
    });
  });

  it('refuses a parameter the recipe does not have', () => {
    expect(buildRecipe('challenge-path', { cidrs: '1.2.3.4' })).toMatchObject({ ok: false });
  });
});

describe('recipeEffect', () => {
  it('names what the rule refuses and that it starts by only counting', () => {
    expect(recipeEffect('allow-ips-only', { path: '/admin/**', cidrs: '203.0.113.7' }, false)).toBe(
      'Every client outside 203.0.113.7 gets 403 on /admin/**. It starts in log mode: requests are counted, not refused, until you enforce it.'
    );
    expect(recipeEffect('rate-limit-path', { path: '/login', methods: 'POST' }, true)).toBe(
      'One client IP may send 10 POST requests a minute to /login (burst 10); the rest get 429. It applies as soon as it is created.'
    );
  });

  it('describes every recipe', () => {
    for (const id of Object.keys(RECIPES))
      expect(recipeEffect(id as keyof typeof RECIPES, {}, false)).toMatch(/\.$/);
  });
});
