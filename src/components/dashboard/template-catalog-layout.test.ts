import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/components/dashboard/template-catalog.tsx'), 'utf8');

// The catalog sits in a column whose width is not the window's (beside the
// New app rail, or beside Fold's strip): at 496px its viewport-sized three
// columns pushed every card's action past its edge. Two columns at most, and
// only once its own width has room for them.
describe('template catalog layout', () => {
  it('sizes its grid by its own width, not the window', () => {
    expect(source).toMatch(/@container/);
    expect(source).toMatch(/@xl:grid-cols-2/);
    expect(source).not.toMatch(/grid-cols-3/);
    expect(source).not.toMatch(/\blg:grid-cols-/);
  });
});
