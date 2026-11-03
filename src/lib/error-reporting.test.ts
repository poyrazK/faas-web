import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from './api/errors';
import {
  MAX_REPORTS_PER_SESSION,
  REPORT_SCHEMA,
  installErrorReporting,
  redact,
  reportError,
  resetErrorReporting,
  setErrorTransport,
  type ErrorReport,
} from './error-reporting';

afterEach(() => resetErrorReporting());

function capture() {
  const reports: ErrorReport[] = [];
  setErrorTransport({ send: (report) => reports.push(report) });
  return reports;
}

describe('redact', () => {
  it('drops query strings and fragments from absolute and relative URLs', () => {
    expect(redact('GET https://gregale.dev/dashboard/logs?q=card%204242&app=pay#top failed')).toBe(
      'GET https://gregale.dev/dashboard/logs failed'
    );
    expect(redact('at /invite/abc?token=secret-value (chunk.js:1)')).toBe(
      'at /invite/abc (chunk.js:1)'
    );
  });

  it('keeps only the domain of an email address', () => {
    expect(redact('no account for ada.lovelace+ops@example.co.uk')).toBe(
      'no account for …@example.co.uk'
    );
  });

  it('removes credentials and long opaque tokens', () => {
    expect(redact('Authorization: Bearer gk_live.abc-DEF_123=')).toBe(
      'Authorization: Bearer [redacted]'
    );
    expect(redact('session 0f8b2c4d6e8f0a1b2c3d4e5f6a7b8c9d0e1f2a3b expired')).toBe(
      'session [redacted] expired'
    );
    expect(redact('app 5f0c1c2e-0000-4000-8000-000000000001 missing')).toBe(
      'app [redacted] missing'
    );
  });

  it('caps a field at 2,000 characters', () => {
    expect(redact('x '.repeat(5_000))).toHaveLength(2_000);
  });
});

describe('reportError', () => {
  it('sends a redacted report with the path but not its query', () => {
    const reports = capture();
    expect(
      reportError(
        'route',
        new TypeError('cannot read key of ada@example.com'),
        '/dashboard/keys?x=1'
      )
    ).toBe(true);
    expect(reports).toEqual([
      expect.objectContaining({
        schema: REPORT_SCHEMA,
        source: 'route',
        name: 'TypeError',
        message: 'cannot read key of …@example.com',
        path: '/dashboard/keys',
      }),
    ]);
  });

  it('reports the same error once per session', () => {
    const reports = capture();
    const error = new Error('boom');
    expect(reportError('error', error, '/')).toBe(true);
    expect(reportError('error', error, '/')).toBe(false);
    expect(reports).toHaveLength(1);
  });

  it(`stops after ${MAX_REPORTS_PER_SESSION} reports`, () => {
    const reports = capture();
    for (let i = 0; i < MAX_REPORTS_PER_SESSION + 5; i++) reportError('error', new Error(`e${i}`));
    expect(reports).toHaveLength(MAX_REPORTS_PER_SESSION);
  });

  it('skips a 4xx ApiError, a settled answer, and keeps a 5xx', () => {
    const reports = capture();
    const problem = (status: number) =>
      new ApiError({ type: 'about:blank', title: 't', status, code: `c${status}` });
    expect(reportError('route', problem(404))).toBe(false);
    expect(reportError('route', problem(503))).toBe(true);
    expect(reports).toHaveLength(1);
  });

  it('describes a rejection that is not an Error', () => {
    const reports = capture();
    reportError('unhandledrejection', { reason: 'nope' });
    expect(reports[0]).toMatchObject({ name: 'NonError', message: '{"reason":"nope"}' });
  });

  it('never throws, even when the transport does', () => {
    setErrorTransport({
      send: () => {
        throw new Error('transport down');
      },
    });
    expect(() => reportError('error', new Error('first'))).not.toThrow();
  });

  it('goes back to sending nothing when the transport is cleared', () => {
    const reports = capture();
    setErrorTransport(null);
    expect(reportError('error', new Error('quiet'))).toBe(true);
    expect(reports).toEqual([]);
  });
});

describe('installErrorReporting', () => {
  it('reports uncaught errors and unhandled rejections until uninstalled', () => {
    const reports = capture();
    // jsdom reports an uncancelled error event as uncaught, which would fail
    // the run; these are synthetic, so the test cancels its own. The reporter
    // itself never cancels, so the browser still logs the real ones.
    const swallow = (event: Event) => event.preventDefault();
    window.addEventListener('error', swallow);
    try {
      const uninstall = installErrorReporting(window);
      window.dispatchEvent(
        new ErrorEvent('error', { error: new Error('uncaught'), message: 'x', cancelable: true })
      );
      const rejection = new Event('unhandledrejection') as PromiseRejectionEvent;
      Object.defineProperty(rejection, 'reason', { value: new Error('rejected') });
      window.dispatchEvent(rejection);
      uninstall();
      window.dispatchEvent(
        new ErrorEvent('error', { error: new Error('after'), message: 'y', cancelable: true })
      );
    } finally {
      window.removeEventListener('error', swallow);
    }
    expect(reports.map((r) => [r.source, r.message])).toEqual([
      ['error', 'uncaught'],
      ['unhandledrejection', 'rejected'],
    ]);
  });
});

/**
 * With the flag off (the default, and CI's build), Rollup must fold the branch
 * away and drop the module, so the shipped bundle carries no reporter. Reads
 * `dist/`, so it runs only after a build, like `prerender.test.ts`.
 */
describe.skipIf(!existsSync('dist/assets') || process.env.VITE_FEATURE_ERROR_REPORTING)(
  'the production bundle',
  () => {
    it('carries no error reporter while the flag is off', () => {
      const scripts = readdirSync('dist/assets').filter((name) => name.endsWith('.js'));
      expect(scripts.length).toBeGreaterThan(0);
      const carrying = scripts.filter((name) =>
        readFileSync(join('dist/assets', name), 'utf8').includes(REPORT_SCHEMA)
      );
      expect(carrying).toEqual([]);
    });
  }
);
