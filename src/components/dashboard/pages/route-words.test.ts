import { describe, expect, it } from 'vitest';
import { listWords, parseRoute, routesSentence } from './route-words';

const base = {
  slug: 'api',
  tracking: true,
  source: 'live',
  count: 0,
  other: false,
  capHit: false,
} as const;

describe('parseRoute', () => {
  it('splits a method and a path', () => {
    expect(parseRoute('GET /v1/orders')).toMatchObject({
      method: 'GET',
      path: '/v1/orders',
      other: false,
    });
  });

  it('keeps a path without a method, without inventing one', () => {
    expect(parseRoute('/healthz')).toMatchObject({ method: null, path: '/healthz' });
  });

  it('recognises the overflow bucket, alone or after a method', () => {
    expect(parseRoute('__route_other__').other).toBe(true);
    expect(parseRoute('GET __route_other__').other).toBe(true);
  });

  it('keeps anything else as raw text', () => {
    expect(parseRoute('weird')).toMatchObject({ method: null, path: null, other: false });
  });
});

describe('routesSentence', () => {
  it('counts routes that have had traffic', () => {
    expect(routesSentence({ ...base, count: 3 })).toEqual({
      kind: 'listed',
      lead: '3 routes on api have had traffic.',
      rest: '',
    });
    expect(routesSentence({ ...base, count: 1 }).lead).toBe('1 route on api has had traffic.');
  });

  it('says tracking is off before anything else', () => {
    const s = routesSentence({ ...base, tracking: false, source: 'unavailable' });
    expect(s.kind).toBe('off');
    expect(s.lead).toBe('Route tracking is off for api, so its routes aren’t listed.');
  });

  it('does not blame the app or the plan when the list cannot be read', () => {
    const s = routesSentence({ ...base, source: 'unavailable' });
    expect(s.kind).toBe('unavailable');
    expect(s.rest).not.toMatch(/plan/);
  });

  it('says the list may be incomplete when servers did not report or the cap was hit', () => {
    const s = routesSentence({ ...base, count: 50, other: true, source: 'partial', capHit: true });
    expect(s.rest).toContain('a few may be missing');
    expect(s.rest).toContain('Tracking stops at 50 routes');
  });

  it('separates no traffic from tracking being off', () => {
    expect(routesSentence(base)).toMatchObject({
      kind: 'empty',
      lead: 'No requests to api have been recorded recently.',
    });
    // Unknown tracking is not "off".
    expect(routesSentence({ ...base, tracking: undefined }).kind).toBe('empty');
  });
});

describe('listWords', () => {
  it('joins addresses the way a sentence does', () => {
    expect(listWords(['a'])).toBe('a');
    expect(listWords(['a', 'b'])).toBe('a and b');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
});
