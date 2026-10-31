import { describe, expect, it } from 'vitest';
import { formatRelative } from './mock-data';

describe('formatRelative', () => {
  it('renders missing deployment timestamps as Never', () => {
    expect(formatRelative(0)).toBe('Never');
    expect(formatRelative(Number.NaN)).toBe('Never');
  });

  it('renders a valid recent timestamp relative to now', () => {
    expect(formatRelative(Date.now() - 30_000)).toBe('just now');
  });

  it('renders a future timestamp as time to come, not as just now', () => {
    const DAY = 24 * 60 * 60_000;
    expect(formatRelative(Date.now() + 6 * DAY + 60_000)).toBe('in 6d');
    expect(formatRelative(Date.now() + 3 * 60 * 60_000 + 60_000)).toBe('in 3h');
    expect(formatRelative(Date.now() + 10 * 60_000 + 1_000)).toBe('in 10m');
  });

  it('keeps clock skew of a few seconds reading as just now', () => {
    expect(formatRelative(Date.now() + 5_000)).toBe('just now');
  });
});
