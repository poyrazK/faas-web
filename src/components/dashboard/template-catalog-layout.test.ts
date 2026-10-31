import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/components/dashboard/template-catalog.tsx'), 'utf8');

// The catalog sits in a column whose width is not the window's: columns
// sized by the viewport once pushed every card's action past its edge. It is
// one list per category now, like New app's source list, so it never splits
// into columns at all.
describe('template catalog layout', () => {
  it('lays starters out as one list, never in columns', () => {
    expect(source).not.toMatch(/grid-cols-/);
    expect(source).toMatch(/divide-y/);
  });
});
