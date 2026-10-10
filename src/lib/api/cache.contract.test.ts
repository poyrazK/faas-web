import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const contract = readFileSync('api/openapi.yaml', 'utf8');

it('pins the cache timing, closed method and vary vocabularies, and exclusive tag purge', () => {
  const action = contract.split('    EdgeRuleCacheAction:')[1]?.split('    EdgeRuleLimitAction:')[0];
  const purge = contract.split('  /v1/apps/{slug}/cache:')[1]?.split('  /v1/account/overage-cap:')[0];

  expect(action).toContain('stale_while_revalidate_seconds:');
  expect(action).toContain('enum: [GET, HEAD]');
  expect(action).toContain('enum: [Accept-Language, Accept-Encoding]');
  expect(purge).toContain('Path and tag are mutually exclusive');
  expect(purge).toMatch(/- name: tag[\s\S]*maxLength: 128/);
  expect(purge).toContain('Purge durably requested; check policy status for application.');
});
