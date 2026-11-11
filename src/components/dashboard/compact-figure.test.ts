import { expect, it } from 'vitest';
import { compactFigure } from './compact-figure';

it('keeps three significant digits and an upper-case suffix', () => {
  expect(compactFigure(87)).toBe('87');
  expect(compactFigure(934_212)).toBe('934K');
  expect(compactFigure(1_250_000)).toBe('1.25M');
});
