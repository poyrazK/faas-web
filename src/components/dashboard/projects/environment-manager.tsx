import { useState } from 'react';
import { Lock, LockSlash, Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { FIELD, Select, Textarea } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '../primitives';
import { ApiError } from '@/lib/api/errors';
import { validEnvironment, type ProjectEnvironment } from '@/lib/api/projects';
import {
  useCreateEnvironment,
  useDeleteEnvironment,
  useDeleteEnvironmentSecret,
  useEnvironmentConfig,
  useEnvironmentSecrets,
  useProtectEnvironment,
  useUpdateEnvironmentConfig,
  useWriteEnvironmentSecret,
  type ProjectScope,
} from '@/lib/api/environments';

/**
 * Creating, protecting and deleting a project's environments, and editing an
 * environment's shared configuration and shared secrets
 * (faas handlers_projects.go:331-640, docs/env.md "Shared project
 * configuration", docs/secrets.md "Project environment secrets").
 */

type Toast = { kind: 'info' | 'error'; title: string; description?: string; error?: unknown };

/** What a refused environment write means, by the stable code. */
export function environmentFailure(error: unknown, fallback: string, conflict?: string): Toast {
  const code = error instanceof ApiError ? error.code : '';
  switch (code) {
    case 'org_role_forbidden':
      return {
        kind: 'info',
        title: 'Your role cannot do this',
        description: 'Owners and admins protect and delete company environments.',
        error,
      };
    case 'conflict':
      return { kind: 'error', title: fallback, description: conflict, error };
    case 'environment_work_busy':
      return {
        kind: 'info',
        title: 'Work is still running in it',
        description: 'Wait for running work to finish, then delete it again.',
        error,
      };
    case 'plan_limit_project_secrets':
      return { kind: 'info', title: 'Shared secret limit reached', error };
    case 'secret_value_too_large':
      return { kind: 'error', title: 'The value is too large for your plan', error };
    case 'not_found':
      return {
        kind: 'info',
        title: 'Not found',
        description: 'It was removed elsewhere. The list is refreshed.',
      };
    default:
      return { kind: 'error', title: fallback, error };
  }
}

function ProtectionBadge({ isProtected }: { isProtected: boolean }) {
  const [label, color, Icon] = isProtected
    ? (['Protected', 'var(--status-warning)', Lock] as const)
    : (['Unprotected', 'var(--chart-muted)', LockSlash] as const);
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, color }}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export function EnvironmentManager({
  scope,
  items,
  label,
  onCreated,
}: {
  scope: ProjectScope;
  items: ProjectEnvironment[];
  /** The workspace's name, for a company project. */
  label: string;
  onCreated: (slug: string) => void;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const protect = useProtectEnvironment(scope);
  const remove = useDeleteEnvironment(scope);

  const onProtect = async (item: ProjectEnvironment) => {
    const next = !item.protected;
    if (
      !(await confirm(
        next
          ? {
              title: `Protect ${item.slug}?`,
              description: `Promotions into ${item.slug} will need an approval of the exact promotion, and it cannot be deleted while protected.`,
              confirmLabel: 'Protect',
            }
          : {
              title: `Remove protection from ${item.slug}?`,
              description: `Promotions into ${item.slug} no longer need an approval, so anyone who can promote can change what it serves.`,
              confirmLabel: 'Remove protection',
              destructive: true,
            }
      ))
    )
      return;
    try {
      await protect.mutateAsync({ environment: item.slug, protect: next });
      toast({ kind: 'success', title: next ? `${item.slug} is protected` : 'Protection removed' });
    } catch (err) {
      toast(
        environmentFailure(
          err,
          'Could not change protection',
          'The environment is still being cloned. Try again once it is ready.'
        )
      );
    }
  };

  const onDelete = async (item: ProjectEnvironment) => {
    if (
      !(await confirm({
        title: `Delete ${item.slug}?`,
        description: `Its configuration, shared secrets, approval history and pending work are removed, and its managed databases and buckets are revoked. Domains, routes and policies stay with the apps. It is refused while ${item.slug} serves a live release.`,
        confirmLabel: 'Delete environment',
        destructive: true,
        typeToConfirm: item.slug,
      }))
    )
      return;
    try {
      const { cleanupPending } = await remove.mutateAsync({ environment: item.slug });
      toast({
        kind: 'success',
        title: `Deleted ${item.slug}`,
        description: cleanupPending
          ? 'Managed resources are being revoked in the background.'
          : undefined,
      });
    } catch (err) {
      toast(
        environmentFailure(
          err,
          'Could not delete the environment',
          'Only an unprotected environment other than production, with no live release, can be deleted.'
        )
      );
    }
  };

  return (
    <Panel
      title="Manage environments"
      description="Create, protect and delete this project's environments."
    >
      <div className="flex flex-col gap-5">
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {items.map((item) => {
            const deletable = item.slug !== 'production' && !item.protected;
            return (
              <li
                key={item.id}
                className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{item.slug}</span>
                    <ProtectionBadge isProtected={item.protected} />
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Created <Timestamp value={item.created_at} />
                    {item.cloned_from ? ` from ${item.cloned_from}` : ''}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={protect.isPending}
                    onClick={() => void onProtect(item)}
                  >
                    {item.protected ? 'Unprotect' : 'Protect'}
                  </Button>
                  {deletable ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => void onDelete(item)}
                      aria-label={`Delete ${item.slug}`}
                    >
                      <Trash aria-hidden />
                      Delete
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {item.slug === 'production'
                        ? 'Production cannot be deleted'
                        : 'Unprotect to delete'}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <CreateEnvironment scope={scope} items={items} label={label} onCreated={onCreated} />
      </div>
    </Panel>
  );
}

function CreateEnvironment({
  scope,
  items,
  label,
  onCreated,
}: {
  scope: ProjectScope;
  items: ProjectEnvironment[];
  label: string;
  onCreated: (slug: string) => void;
}) {
  const { toast } = useToast();
  const create = useCreateEnvironment(scope);
  const [slug, setSlug] = useState('');
  const [isProtected, setProtected] = useState(false);
  const [from, setFrom] = useState('');
  const [share, setShare] = useState(false);
  const taken = items.some((item) => item.slug === slug);
  const valid = validEnvironment(slug) && !taken;
  const submit = async () => {
    try {
      const created = await create.mutateAsync({
        body: {
          slug,
          protected: isProtected,
          ...(from ? { from_environment: from, share_resources: share } : {}),
        },
      });
      toast({
        kind: 'success',
        title: `Created ${created.slug}`,
        description: from ? `Configuration and secrets were copied from ${from}.` : undefined,
      });
      setSlug('');
      setFrom('');
      setShare(false);
      setProtected(false);
      onCreated(created.slug);
    } catch (err) {
      toast(
        environmentFailure(
          err,
          'Could not create the environment',
          scope.org
            ? 'The name is taken, or a company environment cannot be copied from another yet.'
            : 'The project already has an environment with this name, or a copied resource cannot be cloned.'
        )
      );
    }
  };
  return (
    <form
      className="grid gap-4 sm:max-w-xl sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        New environment
        <input
          className={`${FIELD} font-mono`}
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          placeholder="preview"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={slug && !valid ? true : undefined}
        />
        <span className="text-xs text-muted-foreground">
          {taken
            ? 'This project already has one by that name.'
            : 'Lowercase letters, digits and dashes; "default" is reserved.'}
        </span>
      </label>
      {scope.org ? (
        <p className="self-center text-xs text-muted-foreground">
          New {label} environments start empty: the API does not copy one company environment into
          another yet.
        </p>
      ) : (
        <label className="flex flex-col gap-1.5 text-sm">
          Copy from (optional)
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Start empty</option>
            {items.map((item) => (
              <option key={item.id} value={item.slug}>
                {item.slug}
              </option>
            ))}
          </Select>
          <span className="text-xs text-muted-foreground">
            Copies configuration, variables and sealed secrets. Managed databases and buckets get
            fresh, isolated copies.
          </span>
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isProtected}
          onChange={(e) => setProtected(e.target.checked)}
        />
        Protected: promotions into it need an approval
      </label>
      {from && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
          Share {from}&apos;s databases and buckets instead of copying them
        </label>
      )}
      <div className="sm:col-span-2">
        <Button type="submit" disabled={!valid || create.isPending}>
          <Plus aria-hidden />
          Create environment
        </Button>
      </div>
    </form>
  );
}

const MAX_KEYS = 256;

function parseConfig(text: string): { values?: Record<string, unknown>; error?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'Not valid JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return { error: 'The configuration is one JSON object.' };
  if (Object.keys(parsed).length > MAX_KEYS)
    return { error: `At most ${MAX_KEYS} top-level keys.` };
  return { values: parsed as Record<string, unknown> };
}

export function EnvironmentConfigEditor({
  scope,
  environment,
}: {
  scope: ProjectScope;
  environment: string;
}) {
  const read = useEnvironmentConfig(scope, environment);
  const phase = queryPhase({ error: read.error, loading: read.isPending });
  return (
    <Panel
      title="Shared configuration"
      description={`Variables every service in ${environment} inherits. A service's own variable of the same name wins.`}
    >
      {phase !== 'ready' || !read.data ? (
        <InlinePhase
          phase={phase}
          error={read.error}
          loadingMessage="Reading the configuration…"
          onRetry={() => void read.refetch()}
        />
      ) : (
        <ConfigForm
          key={`${environment}:${read.data.version}`}
          scope={scope}
          environment={environment}
          version={read.data.version}
          hash={read.data.config_hash}
          updatedAt={read.data.updated_at}
          values={read.data.values}
        />
      )}
    </Panel>
  );
}

function ConfigForm({
  scope,
  environment,
  version,
  hash,
  updatedAt,
  values,
}: {
  scope: ProjectScope;
  environment: string;
  version: number;
  hash: string;
  updatedAt?: string;
  values: Record<string, unknown>;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const update = useUpdateEnvironmentConfig(scope, environment);
  const initial = JSON.stringify(values, null, 2);
  const [text, setText] = useState(initial);
  const parsed = parseConfig(text);
  const save = async () => {
    if (!parsed.values) return;
    if (
      !(await confirm({
        title: `Replace ${environment}'s configuration?`,
        description: `The whole document becomes version ${version + 1}; keys left out are removed. Changed variables reach each service in ${environment} at its next wake, and running instances keep what they started with.`,
        confirmLabel: 'Save configuration',
      }))
    )
      return;
    try {
      await update.mutateAsync(parsed.values);
      toast({ kind: 'success', title: `Saved version ${version + 1}` });
    } catch (err) {
      toast(environmentFailure(err, 'Could not save the configuration'));
    }
  };
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Version {version}</span>
        {updatedAt && (
          <span>
            Saved <Timestamp value={updatedAt} />
          </span>
        )}
        <CopyableId value={hash} label="configuration hash" />
      </p>
      <label className="flex flex-col gap-1.5 text-sm">
        Configuration (JSON)
        <Textarea
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="font-mono text-xs"
          aria-invalid={parsed.error ? true : undefined}
        />
        <span
          className="text-xs"
          style={parsed.error ? { color: 'var(--status-critical)' } : undefined}
        >
          {parsed.error ??
            'Top-level keys like LOG_LEVEL with a string, number or boolean value become variables; other keys stay in the document. Secret-shaped names are refused: use shared secrets.'}
        </span>
      </label>
      <div>
        <Button type="submit" disabled={!parsed.values || text === initial || update.isPending}>
          Save configuration
        </Button>
      </div>
    </form>
  );
}

/** The path grammar of a secret key (spec parameter SecretKey). */
const SECRET_KEY = /^[A-Z][A-Z0-9_]{0,127}$/;

export function EnvironmentSecrets({
  scope,
  environment,
}: {
  scope: ProjectScope;
  environment: string;
}) {
  const confirm = useConfirm();
  const { toast } = useToast();
  const read = useEnvironmentSecrets(scope, environment);
  const write = useWriteEnvironmentSecret(scope, environment);
  const remove = useDeleteEnvironmentSecret(scope, environment);
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [rotating, setRotating] = useState<string | null>(null);
  const [rotated, setRotated] = useState('');
  const secrets = read.data?.secrets ?? [];
  const phase = queryPhase({
    error: read.error,
    loading: read.isPending,
    isEmpty: secrets.length === 0,
  });
  const exists = secrets.some((s) => s.key === key);

  const onSet = async () => {
    try {
      await write.mutateAsync({ key, value, rotate: false });
      toast({
        kind: 'success',
        title: `Set ${key}`,
        description: 'Services read it at their next boot.',
      });
      setKey('');
      setValue('');
    } catch (err) {
      toast(environmentFailure(err, `Could not set ${key}`));
    } finally {
      setValue('');
    }
  };
  const onRotate = async (name: string) => {
    if (
      !(await confirm({
        title: `Replace the value of ${name}?`,
        description: `Every service in ${environment} that does not set ${name} itself receives the new value at its next boot. Running instances keep the old one until then.`,
        confirmLabel: 'Replace value',
      }))
    )
      return;
    try {
      await write.mutateAsync({ key: name, value: rotated, rotate: true });
      toast({ kind: 'success', title: `Rotated ${name}` });
      setRotating(null);
    } catch (err) {
      toast(environmentFailure(err, `Could not rotate ${name}`));
    } finally {
      setRotated('');
    }
  };
  const onDelete = async (name: string) => {
    if (
      !(await confirm({
        title: `Delete ${name}?`,
        description: `Services in ${environment} stop receiving ${name} at their next boot. The value cannot be read back or restored.`,
        confirmLabel: 'Delete secret',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(name);
      toast({ kind: 'success', title: `Deleted ${name}` });
    } catch (err) {
      toast(environmentFailure(err, `Could not delete ${name}`));
    }
  };

  return (
    <Panel
      title="Shared secrets"
      description={`Sealed values every service in ${environment} receives, unless it sets the same key itself. Write-only: a value is never shown again.`}
    >
      <div className="flex flex-col gap-4 text-sm">
        <InlinePhase
          phase={phase}
          error={read.error}
          loadingMessage="Reading shared secrets…"
          emptyMessage={`No shared secrets in ${environment}.`}
          onRetry={() => void read.refetch()}
        />
        {phase === 'ready' && (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {secrets.map((secret) => (
              <li key={secret.key} className="flex flex-col gap-2 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-mono">{secret.key}</span>
                    <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      <span>Version {secret.version}</span>
                      <span>
                        Updated <Timestamp value={secret.updated_at} />
                      </span>
                      <CopyableId value={secret.value_hash} label={`${secret.key} fingerprint`} />
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-expanded={rotating === secret.key}
                      onClick={() => {
                        setRotated('');
                        setRotating(rotating === secret.key ? null : secret.key);
                      }}
                    >
                      Rotate
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() => void onDelete(secret.key)}
                      aria-label={`Delete ${secret.key}`}
                    >
                      <Trash aria-hidden />
                    </Button>
                  </div>
                </div>
                {rotating === secret.key && (
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void onRotate(secret.key);
                    }}
                  >
                    <label className="flex min-w-48 flex-1 flex-col gap-1.5 text-xs">
                      New value for {secret.key}
                      <input
                        type="password"
                        className={FIELD}
                        value={rotated}
                        onChange={(e) => setRotated(e.target.value)}
                        autoComplete="new-password"
                      />
                    </label>
                    <Button type="submit" size="sm" disabled={!rotated || write.isPending}>
                      Replace value
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {read.data && (
          <p className="text-xs text-muted-foreground">
            {secrets.length} of {read.data.limit} shared secrets on your plan.
          </p>
        )}
        <form
          className="grid gap-3 sm:max-w-xl sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void onSet();
          }}
        >
          <label className="flex flex-col gap-1.5 text-xs">
            Key
            <input
              className={`${FIELD} font-mono`}
              value={key}
              onChange={(e) => setKey(e.target.value.trim().toUpperCase())}
              placeholder="DATABASE_PASSWORD"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs">
            Value
            <input
              type="password"
              className={FIELD}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <Button
            type="submit"
            disabled={!SECRET_KEY.test(key) || exists || !value || write.isPending}
          >
            Add secret
          </Button>
          {exists && (
            <span className="text-xs text-muted-foreground sm:col-span-3">
              {key} exists: rotate it above to replace its value.
            </span>
          )}
        </form>
      </div>
    </Panel>
  );
}
