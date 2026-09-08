import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyIconButton } from '@/components/ui/copy-button';
import { FIELD, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { Pill } from '@/components/dashboard/resource-table';
import { errorMessage } from '@/lib/api/errors';
import {
  createBucketS3Credential,
  deleteBucketAccessGrant,
  grantKey,
  revokeBucketS3Credential,
  s3CredentialKey,
  setBucketAccessGrant,
  useBucketAccessGrants,
  useBucketS3Credentials,
} from '@/lib/api/object-storage';
import { useApiKeys } from '@/lib/api/queries';
import { cn } from '@/lib/utils';

/**
 * Who may reach one bucket, in the two ways the platform allows.
 *
 * **Grants** attach a permission to an API key the account already has, so
 * the key that deploys can also be the key that writes objects. The key's own
 * status (`active`, `grace`, `revoked`) is shown beside the grant, because a
 * grant on a revoked key grants nothing.
 *
 * **S3 credentials** are for tools that speak S3 to `s3.gregale.dev`. The
 * secret is returned once, on creation, and never again — so it is shown once
 * with a copy button and an explicit warning, not stored and not re-fetched.
 */

type Permission = 'read' | 'write' | 'read_write';

const PERMISSIONS: { value: Permission; label: string }[] = [
  { value: 'read', label: 'Read' },
  { value: 'write', label: 'Write' },
  { value: 'read_write', label: 'Read and write' },
];

const KEY_STATUS_COLOR: Record<string, string> = {
  active: 'var(--status-good)',
  grace: 'var(--status-warning)',
  revoked: 'var(--status-critical)',
};

export function BucketAccess({ slug, bucket }: { slug: string; bucket: string }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <AccessGrants slug={slug} bucket={bucket} />
      <S3Credentials slug={slug} bucket={bucket} />
    </div>
  );
}

function AccessGrants({ slug, bucket }: { slug: string; bucket: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const grants = useBucketAccessGrants(slug, bucket);
  const keys = useApiKeys();
  const [keyId, setKeyId] = useState('');
  const [permission, setPermission] = useState<Permission>('read');
  const refresh = () => qc.invalidateQueries({ queryKey: grantKey(slug, bucket) });
  const mutation = useMutation({
    mutationFn: (task: () => Promise<unknown>) => task(),
    onSuccess: () => void refresh(),
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'Could not change the grant',
        description: errorMessage(error),
      }),
  });

  const granted = new Set((grants.data?.items ?? []).map((g) => g.key_id));
  const available = (keys.data ?? []).filter((k) => !granted.has(k.id));
  const chosen = keyId || available[0]?.id || '';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!chosen) return;
    mutation.mutate(async () => {
      await setBucketAccessGrant(slug, bucket, chosen, permission);
      setKeyId('');
      toast({ kind: 'success', title: 'Grant saved' });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="label-mono text-muted-foreground">API-key grants</p>
      {grants.isPending ? (
        <p className="text-sm text-muted-foreground">Loading grants…</p>
      ) : grants.error ? (
        <p className="text-sm text-muted-foreground">{errorMessage(grants.error)}</p>
      ) : (grants.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          No API key can reach this bucket yet. The app itself always can.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {grants.data?.items.map((grant) => (
            <li
              key={grant.key_id}
              className="flex flex-wrap items-center gap-3 py-2 text-xs first:pt-0"
            >
              <span className="font-mono">{grant.key_label}</span>
              <Pill label={grant.key_status} color={KEY_STATUS_COLOR[grant.key_status]} />
              <Select
                value={grant.permission}
                onChange={(e) =>
                  mutation.mutate(async () => {
                    await setBucketAccessGrant(
                      slug,
                      bucket,
                      grant.key_id,
                      e.target.value as Permission
                    );
                    toast({ kind: 'success', title: 'Permission changed' });
                  })
                }
                aria-label={`Permission for ${grant.key_label}`}
                className="h-7 text-xs"
              >
                {PERMISSIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
              <Button
                size="xs"
                variant="ghost"
                className="ml-auto"
                aria-label={`Revoke grant for ${grant.key_label}`}
                onClick={() =>
                  void confirm({
                    title: `Revoke ${grant.key_label}'s access?`,
                    description: 'The key stops being able to reach this bucket immediately.',
                    confirmLabel: 'Revoke',
                    destructive: true,
                  }).then((ok) => {
                    if (!ok) return;
                    mutation.mutate(async () => {
                      await deleteBucketAccessGrant(slug, bucket, grant.key_id);
                      toast({ kind: 'success', title: 'Grant revoked' });
                    });
                  })
                }
              >
                <Trash className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">API key</span>
            <Select
              value={chosen}
              onChange={(e) => setKeyId(e.target.value)}
              aria-label="API key to grant"
              className="h-8 text-xs"
            >
              {available.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label ?? k.id.slice(0, 8)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">Permission</span>
            <Select
              value={permission}
              onChange={(e) => setPermission(e.target.value as Permission)}
              aria-label="Grant permission"
              className="h-8 text-xs"
            >
              {PERMISSIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </label>
          <Button type="submit" size="sm" variant="outline" busy={mutation.isPending}>
            <Plus className="h-3.5 w-3.5" />
            Grant
          </Button>
        </form>
      )}
    </div>
  );
}

function S3Credentials({ slug, bucket }: { slug: string; bucket: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const credentials = useBucketS3Credentials(slug, bucket);
  const [label, setLabel] = useState('');
  const [permission, setPermission] = useState<Permission>('read');
  const [secret, setSecret] = useState<{ accessKeyId: string; secret: string } | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: s3CredentialKey(slug, bucket) });
  const mutation = useMutation({
    mutationFn: (task: () => Promise<unknown>) => task(),
    onSuccess: () => void refresh(),
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'Could not change the credential',
        description: errorMessage(error),
      }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!label.trim()) return;
    mutation.mutate(async () => {
      const created = await createBucketS3Credential(slug, bucket, label.trim(), permission);
      setLabel('');
      setSecret({ accessKeyId: created.access_key_id, secret: created.secret_access_key });
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="label-mono text-muted-foreground">S3 credentials</p>
      {credentials.isPending ? (
        <p className="text-sm text-muted-foreground">Loading credentials…</p>
      ) : credentials.error ? (
        <p className="text-sm text-muted-foreground">{errorMessage(credentials.error)}</p>
      ) : (credentials.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          No S3 credentials yet. Create one for a tool that speaks S3 to s3.gregale.dev.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {credentials.data?.items.map((credential) => (
            <li
              key={credential.id}
              className="flex flex-wrap items-center gap-3 py-2 text-xs first:pt-0"
            >
              <span>{credential.label}</span>
              <span className="font-mono text-muted-foreground">{credential.access_key_id}</span>
              <Pill
                label={credential.status}
                color={credential.status === 'active' ? 'var(--status-good)' : 'var(--status-idle)'}
              />
              <span className="text-muted-foreground">
                {credential.permission.replace('_', ' + ')}
              </span>
              <span className="text-muted-foreground">
                {credential.last_used_at
                  ? `used ${new Date(credential.last_used_at).toLocaleDateString()}`
                  : 'never used'}
              </span>
              {credential.status === 'active' && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  aria-label={`Revoke ${credential.label}`}
                  onClick={() =>
                    void confirm({
                      title: `Revoke ${credential.label}?`,
                      description: 'Anything using this access key stops working immediately.',
                      confirmLabel: 'Revoke',
                      destructive: true,
                    }).then((ok) => {
                      if (!ok) return;
                      mutation.mutate(async () => {
                        await revokeBucketS3Credential(slug, bucket, credential.id);
                        toast({ kind: 'success', title: 'Credential revoked' });
                      });
                    })
                  }
                >
                  <Trash className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {secret && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-lg border p-3 text-xs"
          style={{ borderColor: 'color-mix(in oklab, var(--status-warning) 40%, transparent)' }}
        >
          <p style={{ color: 'var(--status-warning)' }}>
            This secret is shown once. Copy it now; the platform keeps only its hash.
          </p>
          <div className="flex items-center gap-2">
            <code className="font-mono">{secret.accessKeyId}</code>
            <CopyIconButton text={secret.accessKeyId} label="access key id" />
          </div>
          <div className="flex items-center gap-2">
            <code className="truncate font-mono">{secret.secret}</code>
            <CopyIconButton text={secret.secret} label="secret access key" />
          </div>
          <Button size="xs" variant="ghost" className="self-start" onClick={() => setSecret(null)}>
            I have copied it
          </Button>
        </div>
      )}

      <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="backup-runner"
            aria-label="Credential label"
            className={cn(FIELD, 'h-8 w-44 text-xs')}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Permission</span>
          <Select
            value={permission}
            onChange={(e) => setPermission(e.target.value as Permission)}
            aria-label="Credential permission"
            className="h-8 text-xs"
          >
            {PERMISSIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!label.trim()}
          busy={mutation.isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          Create
        </Button>
      </form>
    </div>
  );
}
