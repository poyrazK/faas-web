/** Stable provider-neutral explanations; never display raw worker errors. */
export function githubDeployReason(reason?: string): string | undefined {
  if (!reason) return undefined;
  return (
    (
      {
        actions_trigger:
          'This app deploys through GitHub Actions. A push alone does not start a deployment. Run its deployment workflow or change the deployment trigger.',
        branch_not_deployed:
          'This branch has no deployment target. Add a branch mapping or push to the production branch.',
        superseded:
          'A newer commit replaced this commit before deployment. Check the latest commit instead.',
        not_enabled:
          'Automatic deployment is disabled for this app. Enable it in the GitHub deployment policy.',
        tag_not_branch_head:
          'The release tag does not point to the current branch head. Create a release from the current head.',
        no_binding:
          'This repository is no longer bound to this app. Reconnect the repository before pushing again.',
        skip_marker:
          'The commit message contains a skip-deployment marker. Push a commit without that marker to deploy.',
        ignored:
          'This event did not match a deployment trigger. Check the app’s branch mapping and preview policy.',
        invalid_release_tag:
          'The release tag does not match the configured release policy. Check the tag pattern.',
        release_tag_moved:
          'This release tag was moved after creation. Create a new tag for the intended commit.',
      } as Record<string, string>
    )[reason] ?? 'This event was skipped by the deployment policy. Check the app’s GitHub settings.'
  );
}
