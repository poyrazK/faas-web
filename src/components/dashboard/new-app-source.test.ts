import { describe, expect, it } from 'vitest';
import { defaultParseSearch } from '@tanstack/react-router';
import {
  isValidGitHubRepo,
  isValidGitRef,
  validateNewAppSearch,
  newAppPath,
} from './new-app-source';

describe('new app Git source validation', () => {
  it.each(['20261011', 'true', 'null', '1'.repeat(40)])(
    'preserves the string ref %s through the real router parser',
    (ref) => {
      const search = { source: 'git' as const, repo: 'team/api', ref };
      const query = new URL(newAppPath(search), 'https://gregale.dev').search;
      expect(validateNewAppSearch(defaultParseSearch(query))).toMatchObject(search);
    }
  );

  it('round-trips the repository and ref through deployment and onboarding URLs', () => {
    const search = { source: 'git' as const, repo: 'team/api', ref: 'feature/start' };
    expect(newAppPath(search)).toBe(
      '/dashboard/workflows/new?source=git&repo=team%2Fapi&ref=feature%2Fstart'
    );
    expect(newAppPath(search, true)).toBe(
      '/onboarding?source=git&repo=team%2Fapi&ref=feature%2Fstart'
    );
    expect(
      validateNewAppSearch(
        Object.fromEntries(new URLSearchParams(newAppPath(search).split('?')[1]))
      )
    ).toMatchObject(search);
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
