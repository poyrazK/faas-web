import { describe, expect, it } from 'vitest';
import { STEPS } from './process';
import { REASONS } from './why';

/**
 * Five capabilities the console has shipped for a while and the site never
 * mentioned (gap matrix, section B). Each phrase is tied to code in the
 * commit that added it; this test keeps the words on the page.
 */
const copy = [...STEPS.map((s) => s.body), ...REASONS.map((r) => r.body)].join('\n');

describe('landing claims', () => {
  it.each([
    [/canary/i],
    [/rolls? (it |traffic )?back|rollback/i],
    [/seats|roles/i],
    [/spend cap|overage cap/i],
    [/Compose|Procfile|Kubernetes|render\.yaml|fly\.toml/],
  ])('mentions %s', (re) => {
    expect(copy).toMatch(re);
  });
});
