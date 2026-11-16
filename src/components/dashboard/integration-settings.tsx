import { useEffect } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Check, OpenNewWindow } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Panel } from '@/components/dashboard/primitives';
import { consumeOnboardingGitHubReturn, useAuth } from '@/lib/auth';
import { GitHubConnectForm } from './github-connect-form';
import { GitHubConnectError } from './github-connect-error';
import type { SettingsSearch } from './settings-search';
import { consumeGitHubDeployment } from '@/lib/deployment-handoff';
import { SettingsSummary } from './settings-kit';
import { accountSummary, githubSummary } from './settings-words';

/**
 * Account-level GitHub connection.
 *
 * The OAuth start endpoint deliberately remains a normal browser form rather
 * than an API mutation. The server answers the POST with a redirect to
 * GitHub, and the callback returns to this same customer origin. A fetch would
 * turn that redirect into an opaque cross-origin response and leave the user
 * without the provider consent screen.
 */

export function IntegrationSettings({ search }: { search: SettingsSearch }) {
  const navigate = useNavigate();
  const { account, apiReachable } = useAuth();
  const { github, github_error, default_branch } = search;
  const githubConnected = Boolean(account?.github_install_id);
  const justConnected = github === 'connected' && githubConnected;
  const summary = githubSummary(githubConnected);

  useEffect(() => {
    if (!justConnected) return;
    const deploymentReturn = consumeGitHubDeployment();
    const onboardingReturn = consumeOnboardingGitHubReturn();
    if (deploymentReturn) void navigate({ href: deploymentReturn, replace: true });
    else if (onboardingReturn) void navigate({ to: '/onboarding', replace: true });
  }, [justConnected, navigate]);

  return (
    <div className="flex flex-col gap-6">
      {(github === 'connect-forbidden' || github === 'connect-failed') && (
        <GitHubConnectError
          code={github_error ?? (github === 'connect-forbidden' ? 'csrf_missing' : '')}
          disabled={!apiReachable}
        />
      )}
      {justConnected && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm"
        >
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
          <p>
            GitHub is connected.{' '}
            {default_branch ? (
              <span className="text-muted-foreground">
                The detected default branch is <code>{default_branch}</code>.
              </span>
            ) : (
              <span className="text-muted-foreground">You can now deploy from a repository.</span>
            )}
          </p>
        </div>
      )}

      <SettingsSummary
        label="GitHub"
        ariaLabel="GitHub connection"
        tone={summary.tone}
        actions={
          githubConnected ? (
            <Button asChild size="sm" className="gap-1.5">
              <Link to="/dashboard/apps/new">
                Deploy from a repository
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : (
            <GitHubConnectForm disabled={!apiReachable} />
          )
        }
      >
        {summary.sentence}
      </SettingsSummary>
      {!githubConnected && !apiReachable && (
        <p className="text-xs text-muted-foreground">
          The API is currently unreachable. Check the connection and try again.
        </p>
      )}

      {githubConnected && (
        <Panel
          title="GitHub"
          help="Refreshing goes through GitHub again and re-reads your connection. To change which repositories Gregale can see, use Manage on GitHub."
          actions={
            <Badge variant="outline" className="gap-1.5 border-brand/30 text-brand">
              <Check />
              Connected
            </Badge>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <GitHubConnectForm refresh disabled={!apiReachable} />
            <a
              href="https://github.com/settings/installations"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center gap-1.5 well rounded-xl bg-muted/40 px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Manage on GitHub
              <OpenNewWindow className="h-3.5 w-3.5" />
            </a>
          </div>
        </Panel>
      )}
    </div>
  );
}

export function AccountDetails() {
  const { account } = useAuth();
  const summary = accountSummary(account ?? undefined);
  return (
    <div className="flex flex-col gap-6">
      <SettingsSummary
        label="Account"
        ariaLabel="Your account"
        tone={summary.tone}
        facts={summary.facts}
        actions={
          <Button asChild size="sm" variant="outline">
            <Link to="/dashboard/settings" search={{ section: 'security' }}>
              Review security
            </Link>
          </Button>
        }
      >
        {summary.sentence}
      </SettingsSummary>
      <Panel title="Account details">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="label-mono text-muted-foreground">Email</dt>
            <dd className="mt-1 text-sm [overflow-wrap:anywhere]">{account?.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="label-mono text-muted-foreground">Account ID</dt>
            <dd className="mt-1 font-mono text-xs [overflow-wrap:anywhere]">
              {account?.id ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="label-mono text-muted-foreground">Dev environments</dt>
            <dd className="mt-1 text-sm" title="Live `gregale dev` environments">
              {account ? `${account.developer_app_count} running` : '—'}
            </dd>
          </div>
        </dl>
      </Panel>
    </div>
  );
}
