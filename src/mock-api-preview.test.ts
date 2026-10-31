import { describe, expect, it } from 'vitest';
import { mockApi } from '../mock/plugin';

/**
 * `npm run preview:mock` serves a built bundle through `vite preview` with the
 * mock API behind it, so the console can be toured under the production
 * headers. Both Vite servers must get the same middleware installer.
 */
describe('mock API on vite preview', () => {
  it('registers the same installer for the dev and preview servers', () => {
    const plugin = mockApi();
    expect(typeof plugin.configurePreviewServer).toBe('function');
    expect(plugin.configurePreviewServer).toBe(plugin.configureServer);
  });
});
