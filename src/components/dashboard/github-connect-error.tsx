const failures: Record<string, { title: string; reason: string; recovery: string }> = {
  github_installation_not_accessible: {
    title: 'This GitHub installation is not accessible',
    reason:
      'The GitHub account that authorized this request cannot access the selected installation.',
    recovery: 'Sign in to GitHub with an account that can access it, then connect again.',
  },
  github_installation_owner_required: {
    title: 'The GitHub account owner must connect',
    reason: 'This personal GitHub installation can only be authorized by its owner.',
    recovery:
      'Sign in to GitHub as the installation owner, or install Gregale on your own GitHub account.',
  },
  github_org_admin_required: {
    title: 'A GitHub organization admin must connect',
    reason:
      'Your GitHub account does not have the organization role required to authorize this installation.',
    recovery: 'Ask a GitHub organization admin to connect this installation.',
  },
  github_permission_pending: {
    title: 'GitHub permission approval is pending',
    reason:
      'A GitHub organization owner has not accepted a permission requested by the Gregale app.',
    recovery:
      'Ask an organization owner to review the pending request in GitHub App settings, then connect again.',
  },
  github_authorization_failed: {
    title: 'GitHub authorization did not complete',
    reason: 'GitHub could not approve the deployment connection.',
    recovery: 'Start Connect GitHub again. If it keeps happening, contact support.',
  },
  github_access_denied: {
    title: 'GitHub connection cancelled',
    reason: 'GitHub authorization was declined, so Gregale could not finish connecting.',
    recovery: 'Choose Connect GitHub again and approve repository access to continue.',
  },
  csrf_missing: {
    title: 'GitHub connection expired',
    reason: 'The connection request expired or its browser cookie is missing.',
    recovery: 'Start Connect GitHub again in this browser and complete the authorization promptly.',
  },
  csrf_mismatch: {
    title: 'GitHub connection could not be verified',
    reason: 'The GitHub response did not match the connection request started in this browser.',
    recovery: 'Close older connection tabs, then start Connect GitHub again from here.',
  },
  invalid_request: {
    title: 'GitHub returned an incomplete response',
    reason: 'The authorization response was missing information needed to finish connecting.',
    recovery: 'Start Connect GitHub again. If it keeps happening, contact support.',
  },
  github_unreachable: {
    title: 'GitHub connection could not finish',
    reason: 'Gregale could not complete authorization or save the deployment connection.',
    recovery: 'Try connecting again in a minute. If it keeps happening, contact support.',
  },
  oauth_provider_unavailable: {
    title: 'GitHub connections are temporarily unavailable',
    reason: 'GitHub connections are not enabled correctly on Gregale right now.',
    recovery:
      'Try again later, or contact support. Changing your GitHub permissions will not fix this.',
  },
  github_account_conflict: {
    title: 'GitHub deployment connection could not be saved',
    reason: 'Gregale rejected a deployment connection that is already used by another account.',
    recovery:
      'The same GitHub account can be used for deployments here. Contact support if this error continues.',
  },
};

const fallback = {
  title: 'GitHub connection could not finish',
  reason: 'Gregale did not receive a completed GitHub deployment connection.',
  recovery: 'Start Connect GitHub again. If it keeps happening, contact support.',
};

/** Callback URLs carry only stable codes; provider responses never become UI copy. */
export function GitHubConnectError({ code }: { code: string }) {
  const failure = Object.hasOwn(failures, code) ? failures[code] : undefined;
  const { title, reason, recovery } = failure ?? fallback;
  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
    >
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground">{reason}</p>
      <p>{recovery}</p>
      {failure && <p className="text-xs text-muted-foreground">Error code: {code}</p>}
    </div>
  );
}
