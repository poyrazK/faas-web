import { describe, expect, it } from 'vitest';
import { isValidOrgSlug, slugFromName } from './org-slug';

describe('org slugs', () => {
  it('derives a kebab slug from a display name', () => {
    expect(slugFromName('Acme  Robotics, Inc.')).toBe('acme-robotics-inc');
  });

  it('validates length and shape', () => {
    expect(isValidOrgSlug('acme')).toBe(true);
    expect(isValidOrgSlug('a')).toBe(false);
    expect(isValidOrgSlug('-acme')).toBe(false);
    expect(isValidOrgSlug('a'.repeat(41))).toBe(false);
    expect(isValidOrgSlug('acme--corp')).toBe(false);
  });
});
