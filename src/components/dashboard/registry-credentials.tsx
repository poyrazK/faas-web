import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD as BASE_FIELD } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import {
  useDeleteJobRegistryCredential,
  useJobRegistryCredentials,
  useSetJobRegistryCredential,
} from '@/lib/api/jobs';
import {
  useAppRegistryCredentials,
  useDeleteAppRegistryCredential,
  useSetAppRegistryCredential,
} from '@/lib/api/queries';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { Trash } from 'iconoir-react';
import { IconButton } from '@/components/ui/icon-button';
import { Sheet } from './kit/sheet';
import { registryLine, registryQuotaWords } from './source-access-words';
import { InlinePhase, Panel, queryPhase } from './primitives';

const FIELD = `${BASE_FIELD} w-full`;
const CODE_FIELD = `${FIELD} font-mono`;

interface CredentialRow {
  registry: string;
  username: string;
  updated_at: string;
}

interface CredentialList {
  credentials: CredentialRow[];
  quota_max?: number;
  count?: number;
}

type Credential = { registry: string; username: string; password: string };

/**
 * Sealed private-registry credentials, for an app's image pulls or a job's.
 * Both routes take the same body, normalise the host the same way, and never
 * return a password (faas handlers_registry_auth.go and
 * handlers_job_registry_auth.go), so one editor serves both and only the hooks
 * differ.
 */
export function RegistryCredentialsEditor({
  title = 'Private registries',
  description,
  credentials,
  save,
  remove,
  removeDescription,
}: {
  title?: string;
  description: string;
  credentials: UseQueryResult<CredentialList>;
  save: UseMutationResult<unknown, unknown, Credential>;
  remove: UseMutationResult<unknown, unknown, string>;
  removeDescription: string;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const rows = credentials.data?.credentials ?? [];
  const phase = queryPhase({
    error: credentials.error,
    loading: credentials.isPending,
    isEmpty: rows.length === 0,
  });
  const quota = registryQuotaWords(credentials.data?.quota_max);
  const [creating, setCreating] = useState(false);
  const [registry, setRegistry] = useState('https://');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = () => {
    void save
      .mutateAsync({ registry: registry.trim(), username: username.trim(), password })
      .then(() => {
        setPassword('');
        setCreating(false);
        toast({ kind: 'success', title: 'Registry credential saved' });
      })
      .catch((error: unknown) =>
        toast({ kind: 'error', title: 'Could not save credential', error })
      );
  };

  return (
    <Panel
      title={title}
      help={
        <>
          {description}
          {quota && <span className="mt-2 block">{quota}</span>}
        </>
      }
      actions={
        <Button size="sm" onClick={() => setCreating(true)}>
          Add registry
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Sheet open={creating} onClose={() => setCreating(false)} title="Add a registry login">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (registry.trim() && username.trim() && password && !save.isPending) submit();
            }}
          >
            <label className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Registry URL</span>
              <input
                value={registry}
                onChange={(e) => setRegistry(e.target.value)}
                placeholder="https://registry.example.com"
                spellCheck={false}
                className={CODE_FIELD}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Username</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                className={FIELD}
              />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Use an explicit https:// registry URL.
              </p>
              <Button
                size="sm"
                type="submit"
                disabled={!registry.trim() || !username.trim() || !password}
                busy={save.isPending}
              >
                Save credential
              </Button>
            </div>
          </form>
        </Sheet>

        {phase === 'ready' || phase === 'empty' ? (
          <p className="text-base text-foreground/90">
            {registryLine(rows.map((credential) => credential.registry))}
          </p>
        ) : (
          <InlinePhase
            phase={phase}
            error={credentials.error}
            loadingMessage="Reading credentials…"
            onRetry={() => void credentials.refetch()}
          />
        )}
        {phase === 'ready' && (
          <ul
            aria-label="Registry logins"
            className="well flex flex-col divide-y divide-border rounded-xl bg-muted/40"
          >
            {rows.map((credential) => (
              <li key={credential.registry} className="flex items-center gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="break-all font-mono text-xs">{credential.registry}</span>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    Signs in as {credential.username} · saved{' '}
                    <Timestamp value={credential.updated_at} />
                  </span>
                </div>
                <IconButton
                  aria-label={`Remove ${credential.registry}`}
                  disabled={remove.isPending}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: `Remove ${credential.registry}?`,
                        description: removeDescription,
                        confirmLabel: 'Remove credential',
                        destructive: true,
                      }))
                    )
                      return;
                    void remove
                      .mutateAsync(credential.registry)
                      .then(() => toast({ kind: 'success', title: 'Registry credential removed' }))
                      .catch((error: unknown) =>
                        toast({ kind: 'error', title: 'Could not remove credential', error })
                      );
                  }}
                >
                  <Trash className="h-3.5 w-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/** An app's registries, used when it deploys a private image. */
export function RegistryCredentialsPanel({ slug }: { slug: string }) {
  return (
    <RegistryCredentialsEditor
      description="Credentials are sealed by the control plane and never returned to the browser after saving."
      credentials={useAppRegistryCredentials(slug)}
      save={useSetAppRegistryCredential(slug)}
      remove={useDeleteAppRegistryCredential(slug)}
      removeDescription="Future private-image pulls will no longer have these credentials."
    />
  );
}

/**
 * A job's own registries. They are separate from any app's: a job pulls its
 * image with the credentials stored against it (`gregale job registry`).
 */
export function JobRegistryCredentialsPanel({ name }: { name: string }) {
  return (
    <RegistryCredentialsEditor
      title={`Private registries — ${name}`}
      description="Used when this workload pulls its image. Passwords are sealed and never returned after saving."
      credentials={useJobRegistryCredentials(name)}
      save={useSetJobRegistryCredential(name)}
      remove={useDeleteJobRegistryCredential(name)}
      removeDescription="The next image pull for this workload will not have these credentials."
    />
  );
}
