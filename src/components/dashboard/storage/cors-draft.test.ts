import { describe, expect, it } from 'vitest';
import {
  blankCorsDraft,
  corsFromDraft,
  corsProblems,
  corsSentence,
  corsToDraft,
  validOrigin,
} from './cors-draft';

describe('CORS drafts', () => {
  it('round-trips a stored rule', () => {
    const rule = {
      id: 'site',
      allowed_origins: ['https://app.example.com', 'https://*.example.com'],
      allowed_methods: ['GET' as const, 'PUT' as const],
      allowed_headers: ['content-type', 'x-amz-*'],
      expose_headers: ['ETag'],
      max_age_seconds: 3600,
    };
    expect(corsFromDraft(corsToDraft(rule))).toEqual(rule);
  });

  it('accepts the origins apid accepts', () => {
    for (const o of [
      '*',
      'https://app.example.com',
      'http://localhost:5173',
      'https://*.example.com',
    ])
      expect(validOrigin(o)).toBe(true);
    for (const o of [
      'example.com',
      'ftp://example.com',
      'https://a.com/path',
      'https://*.*.com',
      'https://a.com?x=1',
    ])
      expect(validOrigin(o)).toBe(false);
  });

  it('names what is wrong instead of sending it', () => {
    const draft = { ...blankCorsDraft(), origins: 'example.com', methods: [], maxAge: '90000' };
    expect(corsProblems([draft])[0]).toEqual([
      'Not an origin: example.com. Use * or https://host, with at most one * and no path.',
      'Allow at least one method.',
      'Cache time is 0 to 86400 seconds.',
    ]);
    expect(corsProblems([blankCorsDraft()])[0]).toContain('Add at least one origin.');
  });

  it('reads a rule as one sentence', () => {
    expect(
      corsSentence({
        allowed_origins: ['*'],
        allowed_methods: ['GET'],
        expose_headers: ['ETag'],
        max_age_seconds: 600,
      })
    ).toBe('GET from any site · reading ETag · cached 600 s');
  });
});
