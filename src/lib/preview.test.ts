import { describe, expect, it } from 'vitest';
import { isPreviewSlug } from './preview';

/**
 * Preview apps are minted per pull request as `pr-{N}-{parent-slug}`
 * (content/docs/preview-environments.md); nothing else starts that way.
 */
describe('isPreviewSlug', () => {
  it('recognises the pr-<number>- prefix the platform gives preview apps', () => {
    expect(isPreviewSlug('pr-42-hello')).toBe(true);
    expect(isPreviewSlug('hello')).toBe(false);
    expect(isPreviewSlug('pr-x-hello')).toBe(false);
    expect(isPreviewSlug('pr-42')).toBe(false);
  });
});
