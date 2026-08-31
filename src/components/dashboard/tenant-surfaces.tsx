import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { errorMessage } from '@/lib/api/errors';
import {
  useAddTenantHostname,
  useCreateTenantSurface,
  useDeleteTenantSurface,
  useRemoveTenantHostname,
  useTenantSurfaces,
} from '@/lib/api/queries';
import { certTone, hostnameState, type TenantSurface } from '@/lib/tenant-surfaces';

const FIELD =
  'h-9 rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-brand/50';
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

const TONE_COLOR: Record<string, string | undefined> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  bad: 'var(--status-critical)',
  neutral: undefined,
};

export function SurfaceCard({
  surface,
  busy,
  onAddHostname,
  onRemoveHostname,
  onDelete,
}: {
  surface: TenantSurface;
  busy: boolean;
  onAddHostname: (hostname: string) => void;
  onRemoveHostname: (hostname: string) => void;
  onDelete: () => void;
}) {
  const [host, setHost] = useState('');
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{surface.name}</span>
        <Pill
          label={surface.status}
          color={surface.status === 'active' ? 'var(--status-good)' : 'var(--status-warning)'}
        />
        <Pill
          label={`cert ${surface.cert_state}`}
          color={TONE_COLOR[certTone(surface.cert_state)]}
        />
        {surface.cert_not_after && (
          <span className="text-xs text-muted-foreground">
            expires {new Date(surface.cert_not_after).toLocaleDateString()}
          </span>
        )}
        <Button size="sm" variant="destructive" className="ml-auto" onClick={onDelete}>
          Remove surface
        </Button>
      </div>
      {surface.cert_last_error && (
        <p className="mb-2 text-xs" style={{ color: 'var(--status-critical)' }}>
          {surface.cert_last_error}
        </p>
      )}
      <ul className="mb-3 flex flex-col divide-y divide-border">
        {surface.hostnames.map((h) => {
          const state = hostnameState(h);
          return (
            <li key={h.hostname} className="flex flex-col gap-1 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs">{h.hostname}</span>
                <Pill
                  label={state}
                  color={
                    state === 'verified'
                      ? 'var(--status-good)'
                      : state === 'failed'
                        ? 'var(--status-critical)'
                        : 'var(--status-warning)'
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() => onRemoveHostname(h.hostname)}
                >
                  Remove
                </Button>
              </div>
              {!h.verified && (
                <code className="block break-all rounded bg-muted px-2 py-1 font-mono text-[11px]">
                  {h.txt_record}
                </code>
              )}
              {h.last_error && !h.verified && (
                <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
                  {h.last_error}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (HOST_RE.test(host)) {
            onAddHostname(host.toLowerCase());
            setHost('');
          }
        }}
      >
        <input
          aria-label="Hostname"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="shop.customer.example"
          className={`${FIELD} flex-1`}
        />
        <Button type="submit" size="sm" disabled={!HOST_RE.test(host)} busy={busy}>
          Add hostname
        </Button>
      </form>
    </div>
  );
}

/**
 * Bring-your-own-hostname for multi-tenant apps: one surface holds many
 * customer hostnames, each verified by a TXT record, under one SAN cert.
 * The CLI's `tenant-surface` family, on the domains page.
 */
export function TenantSurfacesPanel({ slug, appId }: { slug: string; appId: string }) {
  const list = useTenantSurfaces(slug);
  const create = useCreateTenantSurface(slug);
  const remove = useDeleteTenantSurface(slug);
  const add = useAddTenantHostname(slug);
  const drop = useRemoveTenantHostname(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const surfaces = (list.data?.surfaces ?? []).filter((s) => s.status !== 'deleted');
  const phase = queryPhase({
    error: list.error,
    loading: list.isPending,
    isEmpty: surfaces.length === 0,
  });
  const fail = (title: string) => (err: unknown) =>
    toast({ kind: 'error', title, description: errorMessage(err) });

  return (
    <Panel
      title="Tenant surfaces"
      description="Customer hostnames on this app, each verified by DNS and covered by one certificate."
    >
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || create.isPending) return;
          // `cert_kind` has one allowed value; sent explicitly under the generated type.
          void create
            .mutateAsync({
              app_id: appId,
              name: name.trim(),
              cert_kind: 'per_host_san',
              hostnames: [],
            })
            .then(() => setName(''))
            .catch(fail('Could not create surface'));
        }}
      >
        <input
          aria-label="Surface name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="customers"
          className={`${FIELD} flex-1`}
        />
        <Button type="submit" size="sm" disabled={!name.trim()} busy={create.isPending}>
          New surface
        </Button>
      </form>
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={list.error}
          emptyMessage="No tenant surfaces on this app."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {surfaces.map((s) => (
            <SurfaceCard
              key={s.id}
              surface={s}
              busy={add.isPending}
              onAddHostname={(hostname) =>
                void add.mutateAsync({ id: s.id, hostname }).catch(fail('Could not add hostname'))
              }
              onRemoveHostname={(hostname) =>
                void drop
                  .mutateAsync({ id: s.id, hostname })
                  .catch(fail('Could not remove hostname'))
              }
              onDelete={() =>
                void confirm({
                  title: `Remove ${s.name}?`,
                  description: `${s.hostnames.length} hostname${s.hostnames.length === 1 ? '' : 's'} stop resolving to this app and the certificate is retired.`,
                  confirmLabel: 'Remove surface',
                  destructive: true,
                  typeToConfirm: s.name,
                }).then((ok) => {
                  if (!ok) return;
                  void remove.mutateAsync(s.id).catch(fail('Could not remove surface'));
                })
              }
            />
          ))}
        </div>
      )}
    </Panel>
  );
}
