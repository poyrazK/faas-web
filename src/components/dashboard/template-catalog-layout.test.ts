import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve('src/components/dashboard/template-catalog.tsx'), 'utf8');

// The catalog sits in a column whose width is not the window's (beside the
// New app rail, or beside Fold's strip): at 496px its viewport-sized three
// columns pushed every "Use template" past its card.
describe('template catalog layout', () => {
  it('sizes its grid by its own width, not the window', () => {
    expect(source).toMatch(/@container/);
    expect(source).toMatch(/@3xl:grid-cols-3/);
    expect(source).not.toMatch(/\blg:grid-cols-3\b/);
  });
});
