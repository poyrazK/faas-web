import { useState } from 'react';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyIconButton } from '@/components/ui/copy-button';
import { FIELD } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { PlanGated } from '@/components/dashboard/plan-gated';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useAddTenantHostname,
  useApp,
  useCreateTenantSurface,
  useDeleteTenantSurface,
  useRemoveTenantHostname,
  useTenantSurfaces,
  type TenantHostname,
  type TenantSurface,
} from '@/lib/api/queries';
import { cn } from '@/lib/utils';

/**
 * Tenant surfaces (ADR-100): a customer's own hostnames grouped under one
 * per-host SAN certificate.
 *
 * Certificate issuance is the state that matters, and it is reported exactly
 * as the API does: `cert_state` on the surface, `verified` and `last_error`
 * per hostname. A pending certificate is not a failure — it is waiting on a
 * TXT record — so each unverified hostname shows the record to publish, and a
 * failed issuance shows the platform's own reason. Nothing is inferred; a
 * surface with no hostnames has no certificate and says so.
 *
 * The family is plan- and flag-gated with `402 tenant_surfaces_not_allowed`
 * on every route, the list included, so the gate renders as the plan panel
 * rather than an error. Quotas answer 403 with their own codes and a hostname
 * claimed by another surface answers `409 tenant_hostname_already_claimed`.
 */

const SURFACE_STATUS_COLOR: Record<TenantSurface['status'], string> = {
  pending: 'var(--status-warning)',
  active: 'var(--status-good)',
  suspended: 'var(--status-serious)',
  deleted: 'var(--status-idle)',
};

function formatWhen(value: string | undefined | null): string {
  if (!value) return '';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? value : new Date(ms).toLocaleDateString();
}

/** What the certificate state means for the customer, in the API's own terms. */
export function certificateLine(surface: TenantSurface): { color: string; text: string } {
  switch (surface.cert_state) {
    case 'issued':
      return {
        color: 'var(--status-good)',
        text: surface.cert_not_after
          ? `Certificate issued, valid until ${formatWhen(surface.cert_not_after)}.`
          : 'Certificate issued.',
      };
    case 'renewing':
      return {
        color: 'var(--status-warning)',
        text: 'Certificate renewing; the current one stays in use.',
      };
    case 'pending':
      return {
        color: 'var(--status-warning)',
        text: 'Certificate pending. It is issued once every hostname below is verified.',
      };
    case 'failed':
      return {
        color: 'var(--status-critical)',
        text: surface.cert_last_error
          ? `Issuance failed: ${surface.cert_last_error}`
          : 'Issuance failed. The platform recorded no reason.',
      };
    default:
      return {
        color: 'var(--status-idle)',
        text: 'No certificate yet; add a hostname to request one.',
      };
  }
}

function explain(err: unknown): { kind: 'info' | 'error'; title: string; description?: string } {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'tenant_surfaces_not_allowed':
        return { kind: 'info', title: 'Not on your plan', description: errorMessage(err) };
      case 'tenant_surface_quota':
        return { kind: 'info', title: 'Surface limit reached', description: errorMessage(err) };
      case 'tenant_hostname_quota':
        return { kind: 'info', title: 'Hostname limit reached', description: errorMessage(err) };
      case 'tenant_hostname_already_claimed':
        return {
          kind: 'error',
          title: 'Hostname already claimed',
          description: 'Another surface holds this hostname. Remove it there first.',
        };
      case 'not_found':
        return { kind: 'info', title: 'Already gone', description: 'It was removed elsewhere.' };
    }
  }
  return { kind: 'error', title: 'Could not save', description: errorMessage(err) };
}

function parseHostnames(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function TenantSurfaces({ slug }: { slug: string }) {
  const app = useApp(slug);
  const surfaces = useTenantSurfaces(slug);
  const phase = queryPhase({ error: surfaces.error, loading: surfaces.isPending });

  return (
    <PlanGated error={surfaces.error} feature="Tenant surfaces">
      <Panel
        title="Tenant surfaces"
        description="Group your customers' hostnames under one certificate bundle; each hostname is verified by a TXT record."
      >
        {phase === 'unreachable' ? (
          <UnreachableState onRetry={() => void surfaces.refetch()} />
        ) : phase === 'loading' ? (
          <LoadingState message="Loading tenant surfaces…" />
        ) : phase === 'error' ? (
          <ErrorState error={surfaces.error} onRetry={() => void surfaces.refetch()} />
        ) : (
          <div className="flex flex-col gap-6">
            {(surfaces.data?.surfaces.length ?? 0) === 0 ? (
              <EmptyState message="No tenant surfaces yet. Create one with the hostnames it should serve." />
            ) : (
              <ul className="flex flex-col gap-4">
                {surfaces.data?.surfaces.map((surface) => (
                  <li key={surface.id}>
                    <SurfaceCard surface={surface} slug={slug} />
                  </li>
                ))}
              </ul>
            )}
            {app.data && <CreateSurface slug={slug} appId={app.data.id} />}
          </div>
        )}
      </Panel>
    </PlanGated>
  );
}

function SurfaceCard({ surface, slug }: { surface: TenantSurface; slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const remove = useDeleteTenantSurface(slug);
  const addHostname = useAddTenantHostname(slug);
  const removeHostname = useRemoveTenantHostname(slug);
  const [hostname, setHostname] = useState('');
  const cert = certificateLine(surface);

  const onDelete = async () => {
    if (
      !(await confirm({
        title: `Delete surface "${surface.name}"?`,
        description: `Its ${surface.hostnames.length} hostname${surface.hostnames.length === 1 ? '' : 's'} stop being served and the certificate is discarded.`,
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(surface.id);
      toast({ kind: 'success', title: 'Surface deleted' });
    } catch (err) {
      toast(explain(err));
    }
  };

  const onAdd = async () => {
    const value = hostname.trim().toLowerCase();
    if (!value) return;
    try {
      const added = await addHostname.mutateAsync({ id: surface.id, hostname: value });
      setHostname('');
      toast({
        kind: 'success',
        title: `${added.hostname} added`,
        description: 'Publish its TXT record to verify it; the certificate follows.',
      });
    } catch (err) {
      toast(explain(err));
    }
  };

  const onRemoveHostname = async (h: TenantHostname) => {
    if (
      !(await confirm({
        title: `Remove ${h.hostname}?`,
        description: 'It stops being served by this surface.',
        confirmLabel: 'Remove',
        destructive: true,
      }))
    )
      return;
    try {
      await removeHostname.mutateAsync({ id: surface.id, hostname: h.hostname });
      toast({ kind: 'success', title: `${h.hostname} removed` });
    } catch (err) {
      toast(explain(err));
    }
  };

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">{surface.name}</span>
        <Pill label={surface.status} color={SURFACE_STATUS_COLOR[surface.status]} />
        <span className="font-mono text-xs text-muted-foreground">{surface.cert_kind}</span>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => void onDelete()}
          disabled={remove.isPending}
          aria-label={`Delete surface ${surface.name}`}
        >
          <Trash className="h-3.5 w-3.5" />
          Delete
        </Button>
      </div>

      <p className="text-sm" style={{ color: cert.color }}>
        {cert.text}
      </p>

      {surface.hostnames.length === 0 ? (
        <p className="text-sm text-muted-foreground">No hostnames on this surface.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {surface.hostnames.map((h) => (
            <li key={h.hostname} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm">{h.hostname}</span>
                <Pill
                  label={h.verified ? 'verified' : 'unverified'}
                  color={h.verified ? 'var(--status-good)' : 'var(--status-warning)'}
                />
                {h.verified && h.verified_at && (
                  <span className="text-xs text-muted-foreground">
                    since {formatWhen(h.verified_at)}
                  </span>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  onClick={() => void onRemoveHostname(h)}
                  disabled={removeHostname.isPending}
                  aria-label={`Remove ${h.hostname}`}
                >
                  Remove
                </Button>
              </div>
              {!h.verified && (
                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-2">
                    Publish this TXT record, then verification runs on its own:
                    <CopyIconButton text={h.txt_record} label="TXT record" />
                  </span>
                  <code className="overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono">
                    {h.txt_record}
                  </code>
                  {h.last_error && (
                    <span style={{ color: 'var(--status-warning)' }}>
                      Last check: {h.last_error}
                    </span>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!addHostname.isPending) void onAdd();
        }}
      >
        <label className="flex min-w-56 flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Add a hostname</span>
          <input
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="app.customer.example"
            className={cn(FIELD, 'w-full')}
            aria-label={`Hostname to add to ${surface.name}`}
          />
        </label>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          disabled={!hostname.trim()}
          busy={addHostname.isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          Add hostname
        </Button>
      </form>
    </div>
  );
}

function CreateSurface({ slug, appId }: { slug: string; appId: string }) {
  const { toast } = useToast();
  const create = useCreateTenantSurface(slug);
  const [name, setName] = useState('');
  const [hostnames, setHostnames] = useState('');
  const seeds = parseHostnames(hostnames);
  const ready = name.trim().length > 0;

  const submit = async () => {
    try {
      const surface = await create.mutateAsync({
        app_id: appId,
        name: name.trim(),
        cert_kind: 'per_host_san',
        hostnames: seeds,
      });
      setName('');
      setHostnames('');
      toast({
        kind: 'success',
        title: `Surface "${surface.name}" created`,
        description:
          seeds.length > 0
            ? 'Publish each hostname’s TXT record; the certificate is issued once all are verified.'
            : 'Add hostnames to request a certificate.',
      });
    } catch (err) {
      toast(explain(err));
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !create.isPending) void submit();
      }}
    >
      <p className="label-mono text-muted-foreground">New surface</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-48 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="customer-domains"
            className={cn(FIELD, 'w-full')}
            aria-label="Surface name"
          />
        </label>
        <label className="flex min-w-64 flex-1 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Seed hostnames (comma or space separated)
          </span>
          <input
            value={hostnames}
            onChange={(e) => setHostnames(e.target.value)}
            placeholder="app.acme.example, app.globex.example"
            className={cn(FIELD, 'w-full')}
            aria-label="Seed hostnames"
          />
        </label>
        <Button
          type="submit"
          size="sm"
          className="gap-1.5"
          disabled={!ready}
          busy={create.isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          Create surface
        </Button>
      </div>
    </form>
  );
}
