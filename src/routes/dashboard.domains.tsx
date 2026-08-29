import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useAddDomain, useApps, useDeleteDomain, useDomains } from '@/lib/api/queries';
import { slugIndex } from '@/lib/api/adapters';
import { errorMessage } from '@/lib/api/errors';
import { FieldError } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/** A registrable hostname: labels of letters/digits/hyphens, at least one dot. */
const HOST_RULE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/domains')({
  component: DomainsPage,
  head: () => consoleHead('domains'),
});

/**
 * Custom hostnames, from `/v1/domains`.
 *
 * Verification is DNS-based: the API hands back a TXT record to publish, and
 * the row stays unverified until it resolves. That token is the whole point of
 * the page for an unverified domain, so it is shown inline rather than hidden
 * behind a detail view.
 */
interface DomainRow {
  id: string;
  domain: string;
  app: string;
  verified: boolean;
  verifiedAt: string | null;
  txtRecord: string | null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : new Date(ms).toLocaleDateString();
}

function DomainsPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error, refetch } = useDomains();
  const { data: apps } = useApps();
  const addDomain = useAddDomain();
  const deleteDomain = useDeleteDomain();

  const [host, setHost] = useState('');
  const [appSlug, setAppSlug] = useState('');
  const [hostTouched, setHostTouched] = useState(false);
  const hostOk = HOST_RULE.test(host.trim());
  const showHostError = hostTouched && host.trim().length > 0 && !hostOk;

  const rows = useMemo<DomainRow[]>(() => {
    const bySlug = slugIndex(apps ?? []);
    return (data ?? []).map((d) => ({
      // The API keys domains by hostname, not by a surrogate id.
      id: d.domain,
      domain: d.domain,
      app: bySlug.get(d.app_id) ?? d.app_id,
      verified: d.verified,
      verifiedAt: d.verified_at ?? null,
      txtRecord: d.txt_record ?? null,
    }));
  }, [data, apps]);

  const columns: Column<DomainRow>[] = [
    {
      key: 'domain',
      label: 'Domain',
      render: (d) => <span className="font-mono">{d.domain}</span>,
    },
    {
      key: 'verified',
      label: 'Status',
      width: 'w-32',
      render: (d) => (
        <Pill
          label={d.verified ? 'verified' : 'pending'}
          color={d.verified ? 'var(--status-good)' : 'var(--status-warning)'}
        />
      ),
    },
    {
      key: 'app',
      label: 'Routes to',
      render: (d) => <span className="font-mono text-xs text-muted-foreground">{d.app}</span>,
    },
    {
      key: 'txtRecord',
      label: 'TXT record',
      render: (d) =>
        d.verified ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <code className="select-all break-all text-xs text-muted-foreground">
            {d.txtRecord ?? '—'}
          </code>
        ),
    },
    {
      key: 'verifiedAt',
      label: 'Verified',
      numeric: true,
      render: (d) => formatDate(d.verifiedAt),
    },
    {
      key: 'id',
      label: '',
      width: 'w-12',
      render: (d) => (
        <button
          type="button"
          aria-label={`Remove ${d.domain}`}
          onClick={async () => {
            if (
              !(await confirm({
                title: `Remove ${d.domain}?`,
                description:
                  'Traffic to this hostname stops routing here immediately. The DNS record can stay.',
                confirmLabel: 'Remove domain',
                destructive: true,
              }))
            )
              return;
            void deleteDomain
              .mutateAsync(d.domain)
              .then(() => toast({ kind: 'success', title: `Removed ${d.domain}` }))
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not remove', description: errorMessage(err) })
              );
          }}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Trash className="h-3.5 w-3.5" />
        </button>
      ),
    },
  ];

  const submit = () => {
    // The create endpoint binds by app id, while everything the user sees is a
    // slug — so the selection is resolved back to an id here.
    const target = (apps ?? []).find((a) => a.slug === (appSlug || apps?.[0]?.slug));
    if (!target) {
      toast({ kind: 'error', title: 'Pick an app to route the domain to' });
      return;
    }

    void addDomain
      .mutateAsync({ domain: host.trim(), app_id: target.id })
      .then((created) => {
        setHost('');
        toast({
          kind: 'success',
          title: 'Domain added',
          description: created.txt_record
            ? 'Publish the TXT record shown in the table to verify it.'
            : undefined,
        });
      })
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not add domain', description: errorMessage(err) })
      );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Domains"
        description="Custom hostnames and their DNS verification. TLS is issued and renewed automatically once a domain verifies."
      />

      <Panel lit title="Add a domain">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (hostOk && !addDomain.isPending) submit();
          }}
        >
          <label className="flex min-w-56 flex-1 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Hostname</span>
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onBlur={() => setHostTouched(true)}
              aria-invalid={showHostError || undefined}
              aria-describedby={showHostError ? 'domain-host-error' : undefined}
              placeholder="api.example.com"
              className={cn(
                'h-10 rounded-lg border bg-background px-3 text-sm outline-none focus:border-brand',
                showHostError ? 'border-[color:var(--status-critical)]' : 'border-border'
              )}
            />
            {showHostError && (
              <FieldError id="domain-host-error">
                A full hostname with at least one dot, like api.example.com.
              </FieldError>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Routes to</span>
            <select
              value={appSlug}
              onChange={(e) => setAppSlug(e.target.value)}
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand"
            >
              {(apps ?? []).map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.slug}
                </option>
              ))}
            </select>
          </label>

          <Button type="submit" size="sm" className="gap-1.5" busy={addDomain.isPending}>
            <Plus className="h-3.5 w-3.5" />
            Add domain
          </Button>
        </form>
      </Panel>

      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'domain', dir: 'asc' }}
        searchKeys={['domain', 'app']}
        searchPlaceholder="Filter by hostname…"
        emptyMessage="No custom domains yet."
        minWidth="min-w-[820px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />
    </div>
  );
}
