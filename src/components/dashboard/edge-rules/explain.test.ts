import { expect, it } from 'vitest';
import { explainRule } from './explain';

it('explains the actual maintenance response and retry interval', () => {
  expect(explainRule('maintenance', { retry_after_seconds: 0 })).toContain(
    'retry after 60 seconds'
  );
  expect(explainRule('maintenance', { retry_after_seconds: 300 })).toBe(
    'Return a maintenance response (HTTP 503) without sending the request to your app. Ask callers to retry after 300 seconds.'
  );
});
it('distinguishes configured behavior from paused and log-only effects', () => {
  expect(explainRule('redirect', { to: 'https://example.test', status_code: 307 }, false)).toMatch(
    /^Paused — this rule currently has no effect/
  );
  expect(explainRule('throttle', { requests_per_second: 10, burst: 20 }, true, true)).toMatch(
    /^Log only — record matches without changing requests/
  );
  expect(explainRule('waf', { mode: 'observe' })).toContain('without blocking');
});
