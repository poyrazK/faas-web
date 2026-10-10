import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import {
  CREATE_OPTIONS,
  createErrorMessage,
  validateBucketName,
  validateCron,
  validateHostname,
} from './create';

describe('CREATE_OPTIONS', () => {
  it('puts traffic sources on the left and resources on the right, and nothing else', () => {
    expect(CREATE_OPTIONS.in.map((o) => o.kind)).toEqual(['domain', 'cron']);
    expect(CREATE_OPTIONS.out.map((o) => o.kind)).toEqual(['bucket']);
  });
});

describe('validation', () => {
  it.each(['api.acme.dev', 'a-b.example.co.uk'])('accepts host %s', (h) =>
    expect(validateHostname(h)).toBeUndefined()
  );
  it.each(['', 'acme', 'https://acme.dev', 'acme.dev/path', 'Acme .dev'])('rejects host %j', (h) =>
    expect(validateHostname(h)).toBeTruthy()
  );
  it.each(['orders', 'a', 'img-2'])('accepts bucket %s', (b) =>
    expect(validateBucketName(b)).toBeUndefined()
  );
  it.each(['', 'Orders', '1abc', 'a_b', 'x'.repeat(64)])('rejects bucket %j', (b) =>
    expect(validateBucketName(b)).toBeTruthy()
  );
  it('needs five cron fields and a path that starts with /', () => {
    expect(validateCron({ schedule: '0 3 * * *', path: '/sync' })).toBeUndefined();
    expect(validateCron({ schedule: '0 3 * *', path: '/sync' })).toMatch(/five fields/i);
    expect(validateCron({ schedule: '0 3 * * *', path: 'sync' })).toMatch(/start with \//i);
  });
});

describe('createErrorMessage', () => {
  it('maps the codes it knows', () => {
    expect(
      createErrorMessage(new ApiError({ status: 409, code: 'domain_exists', title: 't' }))
    ).toMatch(/already/i);
  });
  it('falls back to the server’s own words for codes it does not know', () => {
    expect(
      createErrorMessage(
        new ApiError({ status: 400, code: 'brand_new_code', title: 'Bad', detail: 'Exactly why.' })
      )
    ).toBe('Exactly why.');
  });
  it('never shows a raw object', () => {
    expect(createErrorMessage(new Error('offline'))).toBe('offline');
    expect(createErrorMessage('?')).toBe('Something went wrong. Try again.');
  });
});
