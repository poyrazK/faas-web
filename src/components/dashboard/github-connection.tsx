import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { CheckCircle, Clock, OpenNewWindow, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useDisconnectGitHub,
  useGitHubConnection,
  useRetryGitHubActivity,
  useSyncGitHub,
  type GitHubConnection,
} from '@/lib/api/github-connection';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { formatRelative } from '@/lib/mock-data';
import { GitHubBranchDeployments } from './github-branch-deployments';

/**
 * Push-to-deploy for one app: which installation and repository it is bound
 * to, which branch deploys where, when GitHub access was last reconciled, and
 * what recent pushes and Check Run updates did — with the repairs apid offers
 * a browser: sync, retry failed activity, and disconnect.
 *
 * Disconnect removes only this app's binding (githubd `UnbindAppRepo`). The
 * account's installation stays, and so do the app and its deployments.
 */

const HEALTH: Record<GitHubConnection['health'], string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unknown: 'Not yet synced',
  not_connected: 'Not connected',
};

type ActivityStatus = NonNullable<GitHubConnection['activity']>['check_updates'][number]['status'];

const ACTIVITY_STATUS: Record<
  ActivityStatus,
  { label: string; icon: typeof CheckCircle; critical?: boolean }
> = {
  pending: { label: 'Queued', icon: Clock },
  processing: { label: 'Processing', icon: RefreshDouble },
  succeeded: { label: 'Done', icon: CheckCircle },
  dead: { label: 'Failed', icon: WarningTriangle, critical: true },
};

const ago = (iso?: string | null) => (iso ? formatRelative(Date.parse(iso)) : 'Never');

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The prose for a failed sync, retry or disconnect, by the problem's stable code. */
function failureCopy(err: unknown, organization: string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'github_install_not_found':
        return 'The GitHub installation is no longer available. Reconnect GitHub in Settings, then sync again.';
      case 'github_unreachable':
        return 'Could not reach GitHub. Try again in a minute.';
      case 'github_not_bound':
        return 'This app is no longer bound to a repository.';
      case 'validation_failed':
        // apid's CodeValidation: here, the named CSRF envelope did not verify
        // (expired or overwritten). The spec's prose calls it `validation`.
        return 'The request’s security token expired before it arrived. Try again — each attempt reads a fresh one.';
      case 'org_role_forbidden':
        // The /install mutations are not reviewed organization routes, so a
        // company app passes only for its creator, as an owner or admin
        // (faas appaccess/access.go:263-270).
        return `For a company app, this takes the member who created the app, while they are an owner or admin of ${organization}.`;
    }
  }
  return errorMessage(err);
}

/** A refused retry: githubd's recovery store is unreachable or unwired (handlers_github_connection.go:173-194). */
function retryFailureCopy(err: unknown, organization: string): string {
  if (err instanceof ApiError && err.code === 'capacity_unavailable')
    return 'GitHub activity recovery is unavailable right now. Try again in a minute.';
  return failureCopy(err, organization);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label-mono text-muted-foreground">{label}</dt>
      <dd className="mt-1 truncate text-sm">{children}</dd>
    </div>
  );
}

export function GitHubConnectionPanel({ slug }: { slug: string }) {
  const connection = useGitHubConnection(slug);
  const sync = useSyncGitHub(slug);
  const disconnect = useDisconnectGitHub(slug);
  const retry = useRetryGitHubActivity(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const workspace = useWorkspaceTarget();
  const organization = workspace.org ? workspace.label : 'its organization';
  const data = connection.data;
  const phase = queryPhase({ error: connection.error, loading: connection.isPending });
  const bound = data?.state === 'bound';
  const repo = data?.repo_full_name ?? '';
  // GitHub bindings stay with the account that made them; organizations do
  // not share them yet (faas docs/organization-app-access.md), so the
  // /install read answers 404 to other members (auth_facade.go:551-556).
  const notShared =
    Boolean(workspace.org) &&
    connection.error instanceof ApiError &&
    connection.error.code === 'not_found';
  const busy = sync.isPending || disconnect.isPending || retry.isPending;

  const runSync = async () => {
    try {
      const result = await sync.mutateAsync();
      if (result.sync_result?.detached) {
        toast({
          kind: 'info',
          title: 'Repository detached',
          description: `GitHub no longer has access to ${repo}, so it was detached from this app. Pushes no longer deploy it.`,
        });
        return;
      }
      const count = result.sync_result?.remote_repository_count ?? 0;
      toast({
        kind: 'success',
        title: 'GitHub connection synced',
        description: `The installation can see ${count} ${count === 1 ? 'repository' : 'repositories'}, including ${repo}.`,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'github_not_bound') void connection.refetch();
      toast({
        kind: 'error',
        title: 'Could not sync GitHub',
        description: failureCopy(err, organization),
      });
    }
  };

  const runRetry = async () => {
    try {
      // One key per press: a resend of this press reuses it, the next press does not.
      const result = await retry.mutateAsync(crypto.randomUUID());
      const pushes = result.retried_webhooks;
      const checks = result.retried_checks;
      if (pushes + checks === 0) {
        toast({
          kind: 'info',
          title: 'Nothing to retry',
          description:
            'No recent push or Check Run update had failed. Activity already queued again stays queued.',
        });
        return;
      }
      const parts = [
        pushes ? count(pushes, 'push', 'pushes') : '',
        checks ? count(checks, 'Check Run update', 'Check Run updates') : '',
      ].filter(Boolean);
      toast({
        kind: 'success',
        title: 'Failed GitHub activity queued again',
        description: `${parts.join(' and ')} queued again; ${
          pushes + checks === 1 ? 'it shows' : 'they show'
        } as Queued until processed.`,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'github_not_bound') void connection.refetch();
      toast({
        kind: 'error',
        title: 'Could not retry GitHub activity',
        description: retryFailureCopy(err, organization),
      });
    }
  };

  const runDisconnect = async () => {
    const ok = await confirm({
      title: 'Disconnect push-to-deploy?',
      description: `Pushes to ${repo} no longer deploy this app. The app and its deployments stay, and the GitHub installation stays connected to your account, so you can bind a repository again.`,
      confirmLabel: 'Disconnect',
      destructive: true,
    });
    if (!ok) return;
    try {
      await disconnect.mutateAsync();
      toast({
        kind: 'success',
        title: 'Push-to-deploy disconnected',
        description: `${repo} no longer deploys this app.`,
      });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not disconnect',
        description: failureCopy(err, organization),
      });
    }
  };

  const activity = data?.activity
    ? [
        ...data.activity.webhook_deliveries.map((item) => ({
          kind: item.event_type === 'push' ? 'Push' : item.event_type.replace(/_/g, ' '),
          status: item.status,
          sha: item.commit_sha,
          at: item.updated_at,
        })),
        ...data.activity.check_updates.map((item) => ({
          kind: 'Check Run',
          status: item.status,
          sha: item.commit_sha,
          at: item.updated_at,
        })),
      ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    : [];
  const failed = activity.filter((item) => item.status === 'dead').length;

  return (
    <section aria-label="GitHub connection">
      <Panel
        title="GitHub"
        description={
          bound
            ? 'Pushes to the production branch deploy this app, and each deployment reports back to GitHub as a check.'
            : 'Bind a repository and pushes to its production branch deploy this app.'
        }
        actions={
          bound ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                busy={sync.isPending}
                disabled={busy}
                onClick={() => void runSync()}
              >
                <RefreshDouble className="h-3.5 w-3.5" />
                Sync now
              </Button>
              <Button
                variant="destructive"
                size="sm"
                busy={disconnect.isPending}
                disabled={busy}
                onClick={() => void runDisconnect()}
              >
                Disconnect
              </Button>
            </div>
          ) : undefined
        }
      >
        {notShared ? (
          <p role="status" className="text-sm text-muted-foreground">
            GitHub connections are not shared through {workspace.label} yet: apid shows an app’s
            connection only to the account that bound it, so for you it reads as not found.
          </p>
        ) : phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={connection.error}
            loadingMessage="Reading the GitHub connection…"
            onRetry={() => void connection.refetch()}
          />
        ) : data.state === 'not_installed' ? (
          <p className="text-sm text-muted-foreground">
            GitHub is not connected to this account, so pushes do not deploy this app.{' '}
            <Link
              to="/dashboard/settings"
              search={{ section: 'integrations' }}
              className="text-brand hover:underline"
            >
              Connect GitHub
            </Link>
          </p>
        ) : data.state === 'installed' ? (
          <div className="flex flex-col gap-2 text-sm text-muted-foreground">
            <p>
              This app is not bound to a repository, so pushes do not deploy this app. Deploying
              from a repository binds it, or bind it from the CLI:
            </p>
            <code className="w-fit max-w-full overflow-x-auto rounded-md border border-border bg-muted px-2.5 py-1.5 font-mono text-xs text-foreground">
              gregale github link {slug} --repo OWNER/NAME
            </code>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Field label="Repository">
                <a
                  href={`https://github.com/${repo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-brand hover:underline"
                >
                  {repo}
                  <OpenNewWindow aria-hidden className="h-3 w-3" />
                </a>
              </Field>
              <Field label="Installation">
                <span className="font-mono">
                  {data.github_login
                    ? `${data.github_login} · ${data.installation_id}`
                    : (data.installation_id ?? '—')}
                </span>
              </Field>
              <Field label="Health">
                <Badge variant="outline">{HEALTH[data.health]}</Badge>
              </Field>
              <Field label="Last sync">
                <span title={data.last_reconciled_at ?? undefined}>
                  {ago(data.last_reconciled_at)}
                </span>
              </Field>
              <Field label="Bound">
                <span title={data.linked_at ?? undefined}>{ago(data.linked_at)}</span>
              </Field>
            </dl>
            {data.last_reconcile_error && (
              <p role="status" className="text-xs text-[color:var(--status-critical)]">
                {data.last_reconcile_error}
              </p>
            )}
            <GitHubBranchDeployments slug={slug} status={data} />
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="label-mono text-muted-foreground">Recent activity</h3>
                {failed > 0 && (
                  <Button
                    variant="outline"
                    size="xs"
                    className="gap-1"
                    busy={retry.isPending}
                    disabled={busy}
                    onClick={() => void runRetry()}
                  >
                    <RefreshDouble />
                    Retry failed activity
                  </Button>
                )}
              </div>
              {failed > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  A failed push deployed nothing, and a failed Check Run update left its pull
                  request without a Gregale status. Retrying queues up to ten recent failures again.
                </p>
              )}
              {activity.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  No pushes or check updates recorded yet.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                  {activity.map((item, i) => {
                    const shown = ACTIVITY_STATUS[item.status];
                    const Icon = shown.icon;
                    return (
                      <li
                        key={`${item.kind}-${item.at}-${i}`}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                      >
                        <span className="w-20 shrink-0">{item.kind}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {item.sha ? item.sha.slice(0, 7) : '—'}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 ${
                            shown.critical
                              ? 'text-[color:var(--status-critical)]'
                              : 'text-muted-foreground'
                          }`}
                        >
                          <Icon aria-hidden className="h-3 w-3" />
                          {shown.label}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground" title={item.at}>
                          {ago(item.at)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </Panel>
    </section>
  );
}
