import { describe, expect, it } from 'vitest';
import { findSecrets } from './secret-scan';

/**
 * The same eight patterns the CLI runs before packing. Values are synthetic:
 * the right prefix and enough filler to satisfy each pattern's length floor.
 */
describe('findSecrets', () => {
  it('flags a live Stripe key as high and a test key as medium', () => {
    const found = findSecrets([
      { key: 'STRIPE', value: 'sk_live_' + 'a'.repeat(24) },
      { key: 'STRIPE_TEST', value: 'sk_test_' + 'a'.repeat(24) },
      { key: 'PORT', value: '8080' },
    ]);
    expect(found).toEqual([
      { key: 'STRIPE', provider: 'stripe_live', severity: 'high' },
      { key: 'STRIPE_TEST', provider: 'stripe_test', severity: 'medium' },
    ]);
  });

  it('recognises the remaining providers', () => {
    const values = {
      GH: 'ghp_' + 'A'.repeat(30),
      AWS: 'AKIA' + 'A'.repeat(16),
      OPENAI: 'sk-' + 'a'.repeat(20) + 'T3BlbkFJ' + 'a'.repeat(20),
      ANTHROPIC: 'sk-ant-' + 'a'.repeat(32),
      GOOGLE: 'AIza' + 'a'.repeat(35),
      PEM: '-----BEGIN RSA PRIVATE KEY-----',
    };
    const found = findSecrets(Object.entries(values).map(([key, value]) => ({ key, value })));
    expect(found.map((f) => f.provider)).toEqual([
      'github_pat',
      'aws_access',
      'openai',
      'anthropic',
      'google_api',
      'private_key_block',
    ]);
    expect(found.every((f) => f.severity === 'high')).toBe(true);
  });

  it('reports one finding per key even when several rules match', () => {
    expect(findSecrets([{ key: 'K', value: 'sk-ant-' + 'a'.repeat(40) }])).toHaveLength(1);
  });
});
