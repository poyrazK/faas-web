import { defaultParseSearch } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import {
  isValidGitHubRepo,
  isValidGitRef,
  newAppPath,
  validateNewAppSearch,
} from './new-app-source';

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

describe('carrying a checked repository through redirects', () => {
  it.each(['20261011', 'true', 'null', '1'.repeat(40)])(
    'preserves the string ref %s through the real router parser',
    (ref) => {
      const search = { source: 'git' as const, repo: 'team/api', ref };
      const query = new URL(newAppPath(search), 'https://gregale.dev').search;
      expect(validateNewAppSearch(defaultParseSearch(query))).toMatchObject(search);
    }
  );

  it('round-trips the repository and ref through New app and onboarding URLs', () => {
    const search = { source: 'git' as const, repo: 'team/api', ref: 'feature/start' };
    expect(newAppPath(search)).toBe(
      '/dashboard/apps/new?source=git&repo=team%2Fapi&ref=feature%2Fstart'
    );
    expect(newAppPath(search, true)).toBe(
      '/onboarding?source=git&repo=team%2Fapi&ref=feature%2Fstart'
    );
  });

  it('carries only the wizard fields, and drops oversized values', () => {
    const path = newAppPath({
      source: 'git',
      repo: 'a'.repeat(600),
      ref: 'main',
      recovery: undefined,
    });
    expect(path).toBe('/dashboard/apps/new?source=git&ref=main');
  });
});
