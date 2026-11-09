import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DotNumeral, GLYPHS, compactFigure } from './dot-numeral';

describe('DotNumeral', () => {
  it('has a glyph for every character a compact figure can produce', () => {
    for (const value of [0, 7, 42, 999, 1_234, 934_212, 1_250_000, 3_400_000_000]) {
      for (const ch of compactFigure(value)) expect(GLYPHS[ch], `${value}: ${ch}`).toBeDefined();
    }
  });

  it('draws every glyph seven rows tall with a constant width', () => {
    for (const [ch, rows] of Object.entries(GLYPHS)) {
      expect(rows, ch).toHaveLength(7);
      expect(new Set(rows.map((r) => r.length)).size, ch).toBe(1);
    }
  });

  it('gives screen readers the full number, not the dots', () => {
    render(<DotNumeral text={compactFigure(934_212)} label="934,212 requests" />);
    expect(screen.getByRole('img', { name: '934,212 requests' })).toBeInTheDocument();
    expect(compactFigure(934_212)).toBe('934K');
    expect(compactFigure(1_250_000)).toBe('1.25M');
  });
});
