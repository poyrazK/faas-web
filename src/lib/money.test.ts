import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_CURRENCY,
  formatCents,
  formatMillicentRate,
  formatMillicents,
  parseUsdMillicents,
} from './money';

describe('account money', () => {
  it('is USD, as apid reports it (faas pkg/financial/currency.go)', () => {
    expect(ACCOUNT_CURRENCY).toBe('USD');
  });
  it('formats cents and millicents as dollars', () => {
    expect(formatCents(2000)).toBe('$20.00');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatMillicents(412_000)).toBe('$4.12');
  });
  it('keeps a fraction-of-a-cent unit price to the millicent', () => {
    expect(formatMillicentRate(1_000)).toBe('$0.01');
    expect(formatMillicentRate(1)).toBe('$0.00001');
    expect(formatMillicentRate(0)).toBe('$0.00');
  });
  it('parses dollars typed by a person to exact millicents', () => {
    expect(parseUsdMillicents('10')).toBe(1_000_000);
    expect(parseUsdMillicents(' $8.5 ')).toBe(850_000);
    expect(parseUsdMillicents('0.07')).toBe(7_000);
    expect(parseUsdMillicents('0')).toBe(0);
    // 0.1 + 0.2 is not 0.3 in floating point; the parse never multiplies a float.
    expect(parseUsdMillicents('1234567.29')).toBe(123_456_729_000);
    for (const bad of ['', 'ten', '1.234', '-1', '1e3', '01', '.5', '1,000'])
      expect(parseUsdMillicents(bad)).toBeUndefined();
    expect(parseUsdMillicents('9'.repeat(20))).toBeUndefined();
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe('no euro amounts in the console', () => {
  // The landing plan catalog parses upstream docs/plans.md and owns its own
  // currency (see plan-catalog-parser.ts); everything else is account money.
  // schema.d.ts is generated from upstream prose and is not a formatter.
  // customer-billing.tsx defaults the currency a customer picks for their own
  // end customers' rate cards, which is theirs to choose, not account money.
  const files = walk(resolve('src')).filter(
    (f) => !/plan-catalog|schema\.d\.ts$|customer-billing\.tsx$/.test(f)
  );
  it.each(files.map((f) => [f.replace(resolve('.') + '/', ''), f]))(
    '%s formats no EUR amount',
    (_name, file) => {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/'EUR'/);
      expect(text).not.toMatch(/€/);
    }
  );
});
