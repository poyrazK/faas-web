import { describe, expect, it } from 'vitest';
import { capLabel, STREAMING_STATUS } from './streaming-cap';

describe('streaming cap', () => {
  it('covers every status', () => {
    expect(Object.keys(STREAMING_STATUS).sort()).toEqual(
      [
        'accept-json-downgrade',
        'flag-disabled',
        'operator-disabled',
        'plan-disallows',
        'streaming',
        'upgrade-bypass',
      ].sort()
    );
  });

  it('humanises bytes and treats 0 as unlimited', () => {
    expect(capLabel(0)).toBe('unlimited');
    expect(capLabel(5 * 1024 * 1024)).toBe('5 MB');
    expect(capLabel(1536)).toBe('1.5 KB');
    expect(capLabel(512)).toBe('512 B');
  });
});
