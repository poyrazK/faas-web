import { useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowRight, Check, Github, OpenNewWindow } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { MIN_PASSWORD_LENGTH, useAuth } from '@/lib/auth';
import { consoleHead } from '@/lib/seo';

type AccountSearch = {
  github?: string;
  default_branch?: string;
};

export const Route = createFileRoute('/dashboard/account')({
  validateSearch: (search: Record<string, unknown>): AccountSearch => ({
    github: typeof search.github === 'string' ? search.github : undefined,
    default_branch: typeof search.default_branch === 'string' ? search.default_branch : undefined,
  }),
  component: AccountPage,
  head: () => consoleHead('account'),
});

/**
 * Account-level GitHub connection.
 *
 * The OAuth start endpoint deliberately remains a normal browser form rather
 * than an API mutation. The server answers the POST with a redirect to
 * GitHub, and the callback returns to this same customer origin. A fetch would
 * turn that redirect into an opaque cross-origin response and leave the user
 * without the provider consent screen.
 */

/**
 * Add a password to an OAuth-only account — POST
 * /dashboard/account/set-password, apid's own form-encoded route (302 on
 * success). After it lands, email + password works alongside the provider.
 */
function SetPasswordPanel() {
  const { toast } = useToast();
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (password.length < MIN_PASSWORD_LENGTH || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/dashboard/account/set-password', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password }),
        redirect: 'follow',
      });
      if (res.ok || res.redirected) {
        setPassword('');
        toast({
          kind: 'success',
          title: 'Password set',
          description: 'Email sign-in now works too.',
        });
      } else {
        toast({
          kind: 'error',
          title: 'Could not set password',
          description: `The server answered ${res.status}.`,
        });
      }
    } catch {
      toast({ kind: 'error', title: 'Could not set password' });
    } finally {
      setSaving(false);
    }
  };
  return (
    <Panel
      title="Password"
      description="Accounts created through Google or GitHub have no password. Setting one adds email sign-in without touching the provider link."
    >
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="flex min-w-56 flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">New password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand/50"
          />
        </label>
        <Button
          type="submit"
          size="sm"
          disabled={password.length < MIN_PASSWORD_LENGTH}
          busy={saving}
        >
          Set password
        </Button>
        {password.length > 0 && password.length < MIN_PASSWORD_LENGTH && (
          <p className="text-xs text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        )}
      </form>
    </Panel>
  );
}

function AccountPage() {
  const { account, apiReachable } = useAuth();
  const { github, default_branch } = Route.useSearch();
  const githubConnected = Boolean(account?.github_install_id);
  const justConnected = github === 'connected' && githubConnected;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Account"
        description="Identity, integrations, and the connection used to deploy from GitHub."
      />

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

      <Panel
        lit={!githubConnected}
        title="GitHub"
        description="Connect GitHub once to let Gregale fetch repository refs for dashboard and CI deployments."
        actions={
          githubConnected ? (
            <Badge variant="outline" className="gap-1.5 border-brand/30 text-brand">
              <Check />
              Connected
            </Badge>
          ) : undefined
        }
      >
        {githubConnected ? (
          <div className="flex flex-col gap-4">
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Gregale has a durable GitHub App installation for this account. Repository access is
              checked by GitHub for each deployment; the installation token is never shown to the
              browser.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" className="gap-1.5">
                <Link to="/dashboard/workflows/new">
                  Deploy a function
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <a
                href="https://github.com/settings/installations"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Manage on GitHub
                <OpenNewWindow className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                <Github className="h-4 w-4" />
              </span>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Git deployments use the GitHub App installation belonging to your account. Connect
                it to authorize repository access; Gregale will return here after GitHub confirms
                the installation.
              </p>
            </div>
            <form method="post" action="/dashboard/install/connect">
              <Button
                type="submit"
                size="sm"
                variant="cta"
                className="gap-1.5"
                disabled={!apiReachable}
              >
                <Github className="h-3.5 w-3.5" />
                Connect GitHub
              </Button>
            </form>
            {!apiReachable && (
              <p className="text-xs text-muted-foreground">
                The API is currently unreachable. Check the connection and try again.
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Account details" description="The account data currently used by the console.">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="label-mono text-muted-foreground">Email</dt>
            <dd className="mt-1 text-sm">{account?.email ?? '—'}</dd>
          </div>
          <div>
            <dt className="label-mono text-muted-foreground">Plan</dt>
            <dd className="mt-1 text-sm capitalize">{account?.plan ?? '—'}</dd>
          </div>
          <div>
            <dt className="label-mono text-muted-foreground">Apps</dt>
            <dd className="mt-1 text-sm">{account ? `${account.app_count} deployed` : '—'}</dd>
          </div>
          <div>
            <dt className="label-mono text-muted-foreground">Security</dt>
            <dd className="mt-1 text-sm">
              <Link to="/dashboard/security" className="text-brand hover:underline">
                Manage sessions and MFA
              </Link>
            </dd>
          </div>
        </dl>
      </Panel>
      <SetPasswordPanel />
    </div>
  );
}
