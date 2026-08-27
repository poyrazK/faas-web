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
});
