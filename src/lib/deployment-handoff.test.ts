import { describe, expect, it, vi, afterEach } from 'vitest';
import { rememberGitHubDeployment, consumeGitHubDeployment } from './deployment-handoff';

afterEach(() => vi.useRealTimers());

describe('GitHub deployment handoff', () => {
  it('resumes the same repository once after installation', () => {
    rememberGitHubDeployment({ source: 'git', repo: 'team/api', ref: 'release/v2' }, true);
    expect(consumeGitHubDeployment()).toBe(
      '/onboarding?source=git&repo=team%2Fapi&ref=release%2Fv2'
    );
    expect(consumeGitHubDeployment()).toBeUndefined();
  });

  it('does not reopen an abandoned deployment on a later GitHub connection', () => {
    vi.useFakeTimers();
    rememberGitHubDeployment({ source: 'git', repo: 'team/api', ref: 'main' });
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    expect(consumeGitHubDeployment()).toBeUndefined();
  });
});
