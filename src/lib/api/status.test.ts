import { describe, expect, it } from 'vitest';
import { statusRefetchInterval } from './status';

describe('status polling', () => {
  it('polls every 30 seconds only while the document is visible', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    expect(statusRefetchInterval()).toBe(30_000);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    expect(statusRefetchInterval()).toBe(false);
  });
});
