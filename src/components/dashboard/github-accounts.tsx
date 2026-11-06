import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import {
  useGitHubAccounts,
  useDisconnectGitHubAccount,
  useVerifyGitHubAccount,
} from '@/lib/api/github-accounts';
import { errorMessage } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';

type Verification = components['schemas']['GitHubConnectionVerification'];
export function GitHubAccounts() {
  const accounts = useGitHubAccounts();
  const disconnect = useDisconnectGitHubAccount();
  const verify = useVerifyGitHubAccount();
  const confirm = useConfirm();
  const [verified, setVerified] = useState<Record<number, Verification>>({});
  const [failure, setFailure] = useState('');
  const busy = disconnect.isPending || verify.isPending;
  async function remove(id: number, login: string) {
    if (
      !(await confirm({
        title: `Disconnect ${login}?`,
        description:
          'Pushes will stop deploying apps that use this connection in this Gregale account. Existing apps keep running. GitHub sign-in and connections in other Gregale accounts stay connected.',
        confirmLabel: 'Disconnect',
        destructive: true,
      }))
    )
      return;
    setFailure('');
    try {
      await disconnect.mutateAsync(id);
    } catch (err) {
      setFailure(errorMessage(err));
    }
  }
  async function check(id: number) {
    setFailure('');
    try {
      const result = await verify.mutateAsync(id);
      setVerified((v) => ({ ...v, [id]: result }));
    } catch (err) {
      setFailure(errorMessage(err));
    }
  }
  return (
    <div className="flex flex-col gap-3" aria-label="GitHub deployment connections">
      {accounts.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading GitHub connections…
        </p>
      )}
      {(Boolean(accounts.error) || failure) && (
        <p role="alert" className="text-sm text-destructive">
          {failure || errorMessage(accounts.error)}
        </p>
      )}
      {Boolean(accounts.error) && (
        <Button variant="outline" size="sm" onClick={() => void accounts.refetch()}>
          Try again
        </Button>
      )}
      {accounts.data?.connections.map((connection) => {
        const access = verified[connection.installation_id] ?? connection.access;
        const at = access?.verified_at ?? connection.last_verified_at;
        return (
          <div key={connection.installation_id} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  {connection.github_login}{' '}
                  {access?.account_type === 'Organization'
                    ? '(Organization)'
                    : access?.account_type === 'User'
                      ? '(Personal)'
                      : ''}
                </p>
                <p className="text-xs text-muted-foreground">
                  Installation {connection.installation_id} ·{' '}
                  {access?.repository_count ?? connection.repository_count} repositories
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void check(connection.installation_id)}
                >
                  Verify access
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void remove(connection.installation_id, connection.github_login)}
                >
                  Disconnect
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {at
                ? `Last verified: ${new Date(at).toLocaleString()}`
                : 'Access has not been verified yet.'}
              {connection.health === 'degraded' && !verified[connection.installation_id]
                ? ' The last access check failed. Verify access or refresh the connection.'
                : ''}
            </p>
            {access && (
              <div className="mt-2 text-xs text-muted-foreground">
                <p>
                  Repository access:{' '}
                  {access.repository_selection === 'all'
                    ? 'All repositories'
                    : 'Selected repositories'}
                </p>
                <p>
                  Permissions:{' '}
                  {Object.entries(access.permissions ?? {})
                    .map(([name, value]) => `${name}: ${value}`)
                    .join(', ') || 'Not reported by GitHub'}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
