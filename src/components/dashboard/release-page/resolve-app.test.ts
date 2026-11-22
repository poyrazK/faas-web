import { describe, expect, it } from 'vitest';
import { resolveAppSlug } from './resolve-app';

const appId = '0123456789ab4def8123456789abcdef';

describe('resolveAppSlug', () => {
  it('finds the app among the person’s own apps', () => {
    expect(resolveAppSlug(appId, [{ id: appId, slug: 'mine' }], undefined)).toBe('mine');
  });

  it('finds an organization app listed by hyphenated UUID', () => {
    const org = [{ id: '01234567-89ab-4def-8123-456789abcdef', slug: 'shared' }];
    expect(resolveAppSlug(appId, [], org)).toBe('shared');
  });

  it('prefers the personal app when both lists have it', () => {
    expect(
      resolveAppSlug(appId, [{ id: appId, slug: 'mine' }], [{ id: appId, slug: 'shared' }])
    ).toBe('mine');
  });

  it('finds nothing for an app outside both lists', () => {
    expect(resolveAppSlug(appId, [{ id: 'other', slug: 'x' }], [])).toBeUndefined();
  });
});
