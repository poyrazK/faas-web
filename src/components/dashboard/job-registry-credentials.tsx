import { useState } from 'react';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, fieldErrorProps } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useDeleteJobRegistryCredential,
  useJobRegistryCredentials,
  useSetJobRegistryCredential,
} from '@/lib/api/job-detail';

/**
 * Private-registry credentials for one workload's image pulls.
 *
 * The password is write-only: apid seals it on arrival and answers with the
 * registry, username and timestamps alone, so the field is a password input
 * that empties once the save lands. Saving a registry that is already set
 * replaces it without using another slot of the plan's per-workload cap.
 */
export function JobRegistryCredentials({ name }: { name: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const credentials = useJobRegistryCredentials(name);
  const save = useSetJobRegistryCredential(name);
  const remove = useDeleteJobRegistryCredential(name);
  const [registry, setRegistry] = useState('https://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const rows = credentials.data?.credentials ?? [];
  const phase = queryPhase({
    error: credentials.error,
    loading: credentials.isPending,
    isEmpty: rows.length === 0,
  });
  // apid refuses a schemeless or http:// registry (normalizeRegistryHost).
  const registryError = !/^https:\/\/[^/?#\s]+\/?$/i.test(registry.trim())
    ? 'Start the registry URL with https://, then the host, such as https://ghcr.io.'
    : undefined;
  const missing = !username.trim() || !password;

  const onSave = async () => {
    setAttempted(true);
    setFailure(null);
    if (registryError || missing || save.isPending) return;
    try {
      await save.mutateAsync({ registry: registry.trim(), username: username.trim(), password });
    } catch (error) {
      const limit = error instanceof ApiError ? error.problem.limit : undefined;
      setFailure(
        error instanceof ApiError &&
          error.code === 'plan_job_registry_credential_quota' &&
          typeof limit === 'number'
          ? `Your plan allows ${limit} registry credentials per workload. Remove one before adding another.`
          : error instanceof ApiError && error.code === 'plan_job_registry_credentials_not_allowed'
            ? 'Your plan cannot store private-registry credentials for workloads.'
            : errorMessage(error)
      );
      return;
    }
    setPassword('');
    setAttempted(false);
    toast({
      kind: 'success',
      title: 'Registry credential saved',
      description: 'Sealed by the control plane; the next image pull uses it.',
    });
  };

  const onRemove = async (host: string) => {
    if (
      !(await confirm({
        title: `Remove ${host} from ${name}?`,
        description: `Future image pulls from ${host} for ${name} no longer authenticate. Runs already started are not affected.`,
        confirmLabel: 'Remove credential',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(host);
      toast({ kind: 'success', title: 'Registry credential removed' });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'job_registry_credential_not_found') {
        toast({
          kind: 'info',
          title: 'Already removed',
          description: `${host} had no credential.`,
        });
        return;
      }
      toast({ kind: 'error', title: 'Could not remove credential', error });
    }
  };

  return (
    <Panel
      title="Private registries"
      description="Credentials for pulling this workload's image. Passwords are sealed by the control plane and never shown again."
    >
      <div className="flex flex-col gap-5">
        <form
          noValidate
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onSave();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="job-registry-url" className="label-mono text-muted-foreground">
              Registry URL
            </label>
            <input
              id="job-registry-url"
              value={registry}
              onChange={(e) => setRegistry(e.target.value)}
              placeholder="https://registry.example.com"
              spellCheck={false}
              autoComplete="off"
              className={`${FIELD} font-mono`}
              {...fieldErrorProps(attempted ? registryError : undefined, 'job-registry-url-error')}
            />
            {attempted && registryError && (
              <FieldError id="job-registry-url-error">{registryError}</FieldError>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="job-registry-username" className="label-mono text-muted-foreground">
              Username
            </label>
            <input
              id="job-registry-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              maxLength={256}
              className={FIELD}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="job-registry-password" className="label-mono text-muted-foreground">
              Password
            </label>
            <input
              id="job-registry-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className={FIELD}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 sm:col-span-3">
            <p className="text-xs text-muted-foreground">
              {credentials.data
                ? `${credentials.data.count} of ${credentials.data.quota_max} registries for this workload`
                : 'Saving a registry again replaces its credential.'}
            </p>
            <Button size="sm" type="submit" disabled={missing} busy={save.isPending}>
              Save credential
            </Button>
          </div>
          {failure && (
            <p role="alert" className="text-sm text-[color:var(--status-critical)] sm:col-span-3">
              {failure}
            </p>
          )}
        </form>

        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={credentials.error}
            loadingMessage="Reading credentials…"
            emptyMessage="No private registry credentials for this workload."
            onRetry={() => void credentials.refetch()}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {rows.map((credential) => (
              <li key={credential.registry} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-40 flex-1 break-all font-mono text-xs">
                  {credential.registry}
                </span>
                <span className="text-xs text-muted-foreground">
                  {credential.username} · saved <Timestamp value={credential.updated_at} />
                  {' · '}
                  {credential.last_used_at ? (
                    <>
                      last used <Timestamp value={credential.last_used_at} />
                    </>
                  ) : (
                    'not used yet'
                  )}
                </span>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Remove ${credential.registry}`}
                  disabled={remove.isPending}
                  onClick={() => void onRemove(credential.registry)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
