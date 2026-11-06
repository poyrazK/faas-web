import { describe, expect, it } from 'vitest';
import { githubDeployReason } from './github-deploy-reason';
describe('deployment explanations', () => {
  it('explains actionable skips without claiming a deployment succeeded', () => {
    expect(githubDeployReason('branch_not_deployed')).toContain('branch mapping');
    expect(githubDeployReason('actions_trigger')).toContain('workflow');
    expect(githubDeployReason('superseded')).toContain('newer commit');
    expect(githubDeployReason()).toBeUndefined();
  });
  it('does not echo unknown provider or worker text', () => {
    expect(githubDeployReason('private-token-in-error')).not.toContain('private-token');
  });
});
