import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { CopyIconButton } from '@/components/ui/copy-button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { FIELD } from '@/components/ui/field';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Tabs, tabId } from '@/components/dashboard/tabs';
import {
  bindingKey,
  createBucketBinding,
  revokeBucketBinding,
  rotateBucketBinding,
  s3CredentialKey,
  useBucketBindings,
  type BucketBinding,
} from '@/lib/api/object-storage';
import { bindingEnvNames, defaultBindingPrefix, type Permission } from '@/lib/storage-access';
import { useFreshRestart } from '@/lib/api/queries';
import { nodeSnippet, pythonSnippet, type EnvNames } from '@/lib/storage-snippets';
import { cn } from '@/lib/utils';
import { errorMessage } from '@/lib/api/errors';

const PREFIX_RULE = /^[A-Z][A-Z0-9_]{0,47}$/;

const PERMISSIONS: { value: Permission; label: string; hint: string }[] = [
  { value: 'read', label: 'Read', hint: 'Download and list objects' },
  { value: 'write', label: 'Write', hint: 'Upload and delete objects' },
  { value: 'read_write', label: 'Read and write', hint: 'Both' },
];

const ENV_ROLES: { key: keyof EnvNames; role: string }[] = [
  { key: 'endpoint', role: 'S3 endpoint URL' },
  { key: 'region', role: 'Region' },
  { key: 'bucket', role: 'Bucket name' },
  { key: 'access_key_id', role: 'Access key' },
  { key: 'secret_access_key', role: 'Secret key, sealed' },
  { key: 'addressing_style', role: 'path or virtual' },
];

/**
 * Get this bucket into the app's code: a binding creates a least-privilege key
 * for this bucket only and injects it as sealed secrets, whose names the page
 * shows before anything exists, then reuses in the snippet.
 */
export function CodeAccess({
  slug,
  bucketId,
  bucketName,
}: {
  slug: string;
  bucketId: string;
  bucketName: string;
}) {
  const bindings = useBucketBindings(slug, bucketId);
  const items = bindings.data?.items ?? [];
  // Set when a connection is made here: running instances still have the old
  // environment until they restart (apid stamps the change and stales the
  // snapshots, but does not restart a live app for a new binding).
  const [applied, setApplied] = useState<string | null>(null);
  const phase = queryPhase({ loading: bindings.isPending, error: bindings.error });
  const form = (
    <ConnectForm
      slug={slug}
      bucketId={bucketId}
      bucketName={bucketName}
      taken={items}
      onConnected={setApplied}
    />
  );
  const notice = applied && (
    <ApplyNotice slug={slug} prefix={applied} onDone={() => setApplied(null)} />
  );
  if (phase !== 'ready')
    return (
      <InlinePhase phase={phase} error={bindings.error} onRetry={() => void bindings.refetch()} />
    );
  if (items.length === 0)
    return (
      <div className="flex flex-col gap-6">
        {notice}
        {form}
      </div>
    );
  // Once the app is connected, how to use it comes first; a second connection
  // (other rights, other names) is the rarer job.
  return (
    <div className="flex flex-col gap-8">
      {notice}
      <BindingList slug={slug} bucketId={bucketId} items={items} />
      <Snippets env={items[0].secret_keys} permission={items[0].credential.permission} />
      <details className="storage-again group rounded-2xl border border-dashed border-border px-5 py-4">
        <summary className="cursor-pointer text-sm text-muted-foreground group-open:mb-5 hover:text-foreground">
          Connect again with other rights or names
        </summary>
        {form}
      </details>
    </div>
  );
}

function ConnectForm({
  slug,
  bucketId,
  bucketName,
  taken,
  onConnected,
}: {
  slug: string;
  bucketId: string;
  bucketName: string;
  taken: BucketBinding[];
  onConnected: (prefix: string) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const formId = useId();
  const [permission, setPermission] = useState<Permission>('read');
  const [prefix, setPrefix] = useState('');
  const [touched, setTouched] = useState(false);
  const effective = prefix || defaultBindingPrefix(bucketName);
  const invalid = prefix !== '' && !PREFIX_RULE.test(prefix);
  const clash = taken.some((b) => b.prefix === effective);
  // Say what is wrong once the person has acted, not on arrival.
  const showInvalid = touched && invalid;
  const showClash = touched && clash;
  const env = bindingEnvNames(effective);

  const connect = useMutation({
    mutationFn: () =>
      createBucketBinding(slug, bucketId, { permission, ...(prefix ? { prefix } : {}) }),
    onSuccess: (binding) => {
      setPrefix('');
      setTouched(false);
      void qc.invalidateQueries({ queryKey: bindingKey(slug, bucketId) });
      void qc.invalidateQueries({ queryKey: s3CredentialKey(slug, bucketId) });
      onConnected(binding.prefix);
      toast({
        kind: 'success',
        title: `Connected ${slug}`,
        description: `New instances read ${binding.prefix}_*.`,
      });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: `Could not connect ${slug}`,
        description: errorMessage(error),
      }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (invalid || clash) return;
    connect.mutate();
  };

  return (
    <form
      aria-label={`Connect ${slug} to ${bucketName}`}
      onSubmit={submit}
      className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
    >
      <div className="flex flex-col gap-5">
        <div>
          <h3 className="text-base font-medium">Connect {slug}</h3>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Gregale makes a key for this bucket only and hands it to the app as sealed secrets.
            Nothing to paste, nothing to commit.
          </p>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-xs text-muted-foreground">What the code may do</legend>
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-border bg-background p-1">
            {PERMISSIONS.map((p) => (
              <label
                key={p.value}
                className={cn(
                  'pressable flex cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2 text-sm transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[color:var(--brand)]',
                  permission === p.value
                    ? 'bg-card text-foreground shadow-elevation-1'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <input
                  type="radio"
                  name={`${formId}-permission`}
                  value={p.value}
                  checked={permission === p.value}
                  onChange={() => setPermission(p.value)}
                  className="sr-only"
                />
                <span className="font-medium">{p.label}</span>
                <span className="text-xs text-muted-foreground">{p.hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Variable prefix (optional)</span>
          <input
            value={prefix}
            onChange={(e) => setPrefix(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder={defaultBindingPrefix(bucketName)}
            spellCheck={false}
            aria-invalid={showInvalid || showClash || undefined}
            aria-describedby={`${formId}-prefix-help`}
            className={cn(FIELD, 'font-mono text-sm')}
          />
          <span id={`${formId}-prefix-help`} className="text-xs text-muted-foreground">
            {showInvalid ? (
              <span className="text-[color:var(--status-critical)]">
                Use UPPER_SNAKE_CASE: a letter, then letters, digits or underscores (48 at most).
              </span>
            ) : showClash ? (
              <span className="text-[color:var(--status-critical)]">
                {slug} already has secrets named {effective}_*. Pick another prefix.
              </span>
            ) : (
              'Change it to connect the same bucket twice, for example with different rights.'
            )}
          </span>
        </label>
        <Button type="submit" busy={connect.isPending} className="self-start">
          Connect {slug}
        </Button>
      </div>

      <div className="storage-env self-start rounded-2xl border border-border p-4">
        <p className="mb-3 text-xs text-muted-foreground">
          {slug} will read these, set for every instance
        </p>
        <dl className="flex flex-col">
          {ENV_ROLES.map(({ key, role }) => (
            <div
              key={key}
              className="flex items-baseline justify-between gap-4 border-t border-border/60 py-1.5 first:border-t-0"
            >
              <dt className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">{env[key]}</dt>
              <dd className="shrink-0 text-xs text-muted-foreground">{role}</dd>
            </div>
          ))}
        </dl>
      </div>
    </form>
  );
}

const VERB: Record<Permission, string> = {
  read: 'reads',
  write: 'writes',
  read_write: 'reads and writes',
};

function BindingList({
  slug,
  bucketId,
  items,
}: {
  slug: string;
  bucketId: string;
  items: BucketBinding[];
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: bindingKey(slug, bucketId) });
    void qc.invalidateQueries({ queryKey: s3CredentialKey(slug, bucketId) });
  };
  const rotate = useMutation({
    mutationFn: (id: string) => rotateBucketBinding(slug, bucketId, id),
    onSuccess: (binding) => {
      refresh();
      toast({
        kind: 'success',
        title: binding.rotation_pending ? 'Rotation started' : 'Key rotated',
        description: binding.rotation_pending
          ? 'The previous key keeps working until running instances have refreshed.'
          : `${binding.prefix}_* now carries a new key.`,
      });
    },
    onError: (error) =>
      toast({ kind: 'error', title: 'Could not rotate the key', description: errorMessage(error) }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeBucketBinding(slug, bucketId, id),
    onSuccess: () => {
      refresh();
      toast({ kind: 'success', title: 'Disconnected' });
    },
    onError: (error) =>
      toast({ kind: 'error', title: 'Could not disconnect', description: errorMessage(error) }),
  });

  return (
    <section aria-label="Connections from the app's code" className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Connected</h3>
      <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
        {items.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className="min-w-0 flex-1 truncate font-mono text-sm">{b.prefix}_*</span>
            <span className="text-xs text-muted-foreground">{VERB[b.credential.permission]}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {b.credential.access_key_id}
            </span>
            {b.rotation_pending && (
              <span className="text-xs text-[color:var(--status-warning)]">
                Rotating, old key still valid
              </span>
            )}
            <span className="flex gap-1">
              <Button
                size="xs"
                variant="ghost"
                disabled={b.rotation_pending || rotate.isPending}
                aria-label={`Rotate ${b.prefix}`}
                onClick={() =>
                  void confirm({
                    title: `Rotate the key behind ${b.prefix}_*?`,
                    description:
                      'Gregale replaces the access key and secret under the same variable names. The previous key keeps working until running instances have refreshed, so nothing drops mid-request.',
                    confirmLabel: 'Rotate key',
                  }).then((ok) => ok && rotate.mutate(b.id))
                }
              >
                Rotate
              </Button>
              <Button
                size="xs"
                variant="ghost"
                disabled={revoke.isPending}
                aria-label={`Disconnect ${b.prefix}`}
                onClick={() =>
                  void confirm({
                    title: `Disconnect ${b.prefix}_*?`,
                    description:
                      'The key is revoked first, then its secrets are removed from the app. Code that reads them stops reaching this bucket.',
                    confirmLabel: 'Disconnect',
                    destructive: true,
                  }).then((ok) => ok && revoke.mutate(b.id))
                }
              >
                Disconnect
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Language = 'node' | 'python';
const LANGUAGES = [
  { key: 'node', label: 'Node.js' },
  { key: 'python', label: 'Python' },
] as const;

function Snippets({ env, permission }: { env: EnvNames; permission: Permission }) {
  const [language, setLanguage] = useState<Language>('node');
  const panelId = useId();
  const code = language === 'node' ? nodeSnippet(env, permission) : pythonSnippet(env, permission);
  return (
    <section aria-label="Code that reads the injected variables" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h3 className="text-sm font-medium">In your code</h3>
        <Tabs
          label="Language"
          value={language}
          options={LANGUAGES.map((l) => ({ key: l.key, label: l.label }))}
          onChange={setLanguage}
          panelId={panelId}
          className="border-b-0"
        />
      </div>
      <div
        id={panelId}
        role="tabpanel"
        aria-labelledby={tabId(panelId, language)}
        className="storage-code relative overflow-hidden rounded-2xl border border-border"
      >
        <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">{code}</pre>
        <span className="absolute right-2 top-2">
          <CopyIconButton
            text={code}
            label={`${language === 'node' ? 'Node.js' : 'Python'} snippet`}
          />
        </span>
      </div>
    </section>
  );
}

function ApplyNotice({
  slug,
  prefix,
  onDone,
}: {
  slug: string;
  prefix: string;
  onDone: () => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const restart = useFreshRestart(slug);
  return (
    <section
      role="status"
      aria-label="Apply the new variables"
      className="storage-apply flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4"
    >
      <p className="max-w-prose text-sm">
        Running instances keep their current environment until they restart. New instances read{' '}
        <code className="font-mono text-xs">{prefix}_*</code>.
      </p>
      <Button
        size="sm"
        busy={restart.isPending}
        onClick={() =>
          void confirm({
            title: `Restart ${slug} with the new variables?`,
            description:
              'Replacement instances boot from scratch with the new variables. Old instances stop taking new requests and drain before they are destroyed.',
            confirmLabel: 'Restart',
          }).then((ok) => {
            if (!ok) return;
            void restart
              .mutateAsync()
              .then(() => {
                onDone();
                toast({
                  kind: 'success',
                  title: 'Restart queued',
                  description: `${slug} comes back with ${prefix}_* set.`,
                });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not restart', description: errorMessage(err) })
              );
          })
        }
      >
        Restart with the new variables
      </Button>
    </section>
  );
}
