import { describe, expect, it } from 'vitest';
import { cellState, diffSummary } from './env-diff';

const row = (cells: Record<string, { present: boolean; value_hash?: string }>) => ({
  key: 'K',
  kind: 'secret' as const,
  cells,
});

describe('cellState', () => {
  it('distinguishes missing, same, differs and only', () => {
    const r = row({
      default: { present: true, value_hash: 'a' },
      staging: { present: true, value_hash: 'a' },
      prod: { present: false },
    });
    expect(cellState(r, 'prod')).toBe('missing');
    expect(cellState(r, 'default')).toBe('same');
    expect(
      cellState(
        row({
          default: { present: true, value_hash: 'a' },
          staging: { present: true, value_hash: 'b' },
        }),
        'default'
      )
    ).toBe('differs');
    expect(
      cellState(
        row({ default: { present: true, value_hash: 'a' }, staging: { present: false } }),
        'default'
      )
    ).toBe('only');
  });
});

describe('diffSummary', () => {
  it('counts keys and the ones not identical everywhere', () => {
    expect(
      diffSummary({
        app_slug: 'x',
        generated_at: 'now',
        scopes: ['default', 'prod'],
        rows: [
          row({
            default: { present: true, value_hash: 'a' },
            prod: { present: true, value_hash: 'a' },
          }),
          row({ default: { present: true, value_hash: 'a' }, prod: { present: false } }),
        ],
      })
    ).toEqual({ keys: 2, uneven: 1 });
  });
});
