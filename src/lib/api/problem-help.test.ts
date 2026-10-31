import { describe, expect, it } from 'vitest';
import { ApiError } from './errors';
import { problemHelp } from './problem-help';

function problem(extra: Record<string, unknown> = {}) {
  return new ApiError({
    title: 'Domain not verified',
    status: 409,
    code: 'domain_not_verified',
    detail: 'The TXT record was not found.',
    ...extra,
  });
}

describe('problemHelp', () => {
  it('returns the stable code to quote', () => {
    expect(problemHelp(problem()).code).toBe('domain_not_verified');
  });

  it('links docs_url when it lands on a published page, keeping the anchor', () => {
    const help = problemHelp(
      problem({ docs_url: 'https://gregale.dev/docs/custom-domains#verify' })
    );
    expect(help.docsHref).toBe('/docs/custom-domains#verify');
  });

  it('collapses a child path to the published parent guide', () => {
    const help = problemHelp(
      problem({ docs_url: 'https://gregale.dev/docs/custom-domains/verify' })
    );
    expect(help.docsHref).toBe('/docs/custom-domains');
  });

  it('follows a catalogued alias to the page that serves it', () => {
    const help = problemHelp(problem({ docs_url: '/docs/sidecars' }));
    expect(help.docsHref).toBe('/docs/companions');
  });

  it('offers no link for an unpublished page rather than a 404', () => {
    expect(
      problemHelp(problem({ docs_url: 'https://gregale.dev/docs/object-storage' })).docsHref
    ).toBe(undefined);
  });

  it('falls back to the problem type when docs_url is absent', () => {
    const help = problemHelp(problem({ type: 'https://gregale.dev/docs/plans' }));
    expect(help.docsHref).toBe('/docs/plans');
  });

  it('never links off-site', () => {
    const help = problemHelp(problem({ docs_url: 'https://evil.example/docs/plans' }));
    expect(help.docsHref).toBe(undefined);
  });

  it('carries the API hint when it adds something to the message', () => {
    expect(problemHelp(problem({ hint: 'Add the TXT record, then retry.' })).hint).toBe(
      'Add the TXT record, then retry.'
    );
    expect(problemHelp(problem({ hint: 'The TXT record was not found.' })).hint).toBe(undefined);
  });

  it('has nothing to add for a code the console synthesised', () => {
    const synthesised = new ApiError({ title: 'Bad gateway', status: 502, code: 'http_502' });
    expect(problemHelp(synthesised)).toEqual({});
  });

  it('has nothing to add for an error that is not from the API', () => {
    expect(problemHelp(new TypeError('Failed to fetch'))).toEqual({});
  });
});
