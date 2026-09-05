import { describe, expect, it } from 'vitest';
import { formatUsageBytes, formatUsageNumber } from './usage-format';

describe('usage formatting', () => {
  it('does not round a small nonzero metric to zero', () => {
    expect(formatUsageNumber(0.000312)).toContain('0.000312');
    expect(formatUsageNumber(0)).toBe('0');
  });

  it('shows useful binary byte units', () => {
    expect(formatUsageBytes(0)).toBe('0 B');
    expect(formatUsageBytes(1536)).toContain('1.5 KiB');
    expect(formatUsageBytes(3 * 1024 ** 3)).toContain('3 GiB');
  });
});
