import { expect, it } from 'vitest';
import { normalizeId } from './ids';

it('compares hyphenated UUIDs and 32-hex IDs as one form', () => {
  expect(normalizeId('0123-ABCD')).toBe('0123abcd');
  expect(normalizeId('0123456789ab4def8123456789abcdef')).toBe('0123456789ab4def8123456789abcdef');
});
