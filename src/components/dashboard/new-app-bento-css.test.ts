import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve('src/components/dashboard/new-app-bento.css'), 'utf8');

describe('new-app-bento.css', () => {
  it('uses tokens only', () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\bdark\b/);
  });

  // The review measured clipped cells at 1024–1280 with the sidebar open:
  // the grid must respond to its own width, not the window's.
  it('lays the grid out by container queries, not viewport media queries', () => {
    expect(css).toMatch(/container-type: inline-size/);
    // 42rem: beside the sidebar and the rail, a 1440px window leaves the grid
    // ~712px, and the hero layout must appear there.
    expect(css).toMatch(/@container nab \(min-width: 42rem\)/);
    expect(css).toMatch(/@container nab \(min-width: 30rem\)/);
    expect(css).not.toMatch(/@media \(min-width/);
  });

  it('keeps the selection ring for focus, and stops motion when reduced', () => {
    expect(css).toMatch(/\.nab-cell:focus-visible/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
