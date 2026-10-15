import { describe, expect, it } from 'vitest';
import { isValidGitHubRepo, isValidGitRef, validateNewAppSearch } from './new-app-source';

describe('new app Git source validation', () => {
  it('retains a direct container source URL', () => {
    expect(validateNewAppSearch({ source: 'container' }).source).toBe('container');
  });
  it('retains a direct OCI worker source URL across reload', () => {
    expect(validateNewAppSearch({ source: 'worker' }).source).toBe('worker');
  });
  it.each([
    null,
    'bad',
    { app: '../other', repo: 'team/api', ref: 'main' },
    { app: 'demo-app', repo: 'team/api', ref: 'main', deployment: 'bad' },
  ])('rejects malformed recovery pointers %j', (recovery) => {
    expect(validateNewAppSearch({ recovery }).recovery).toBeUndefined();
  });
  it('restores only a bounded non-secret recovery pointer', () => {
    expect(
      validateNewAppSearch({
        recovery: {
          app: 'demo-app',
          repo: 'team/api',
          ref: '20261011',
          deployment: 'a'.repeat(32),
          password: 'discard',
        },
      }).recovery
    ).toEqual({ app: 'demo-app', repo: 'team/api', ref: '20261011', deployment: 'a'.repeat(32) });
  });

  it('accepts API-shaped GitHub owner/repository slugs', () => {
    for (const repo of ['gregale/api', 'one-box/faas_web.git', 'A.B-C/repo_2']) {
      expect(isValidGitHubRepo(repo), repo).toBe(true);
    }
  });

  it('rejects repositories that the source-ref API cannot address', () => {
    for (const repo of ['', 'owner', 'owner/repo/extra', 'owner/repo?ref=main', 'owner/my repo']) {
      expect(isValidGitHubRepo(repo), repo).toBe(false);
    }
  });

  it('accepts ordinary branches, tags, and canonical commit SHAs', () => {
    for (const ref of ['main', 'feature/onboarding', 'v1.2.3', 'a'.repeat(40)]) {
      expect(isValidGitRef(ref), ref).toBe(true);
    }
  });

  it('mirrors the backend ref-shape rejections', () => {
    for (const ref of [
      '',
      '@',
      '/main',
      'main/',
      'feature//x',
      'feature/../main',
      '.hidden',
      'main.lock',
      'abc123',
      'bad ref',
      'bad\u0001ref',
      'main?',
      'x'.repeat(201),
    ]) {
      expect(isValidGitRef(ref), ref).toBe(false);
    }
  });
});
