import { describe, expect, it } from 'vitest';
import { deployments } from './data';

describe('seeded deployments', () => {
  it('record a 40-hex commit for source deployments and none for uploaded ones', () => {
    const github = deployments.filter((d) => d.kind === 'github');
    expect(github.length).toBeGreaterThan(0);
    for (const d of github) expect(d.commit_sha).toMatch(/^[a-f0-9]{40}$/);
    expect(deployments.filter((d) => d.kind === 'tarball').every((d) => !d.commit_sha)).toBe(true);
  });
});
