import { useMemo, useRef, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Activity, Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { InlinePhase, PageHeader, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import {
  useAddDomain,
  useApps,
  useDeleteDomain,
  useDomains,
  useVerifyDomain,
} from '@/lib/api/queries';
import { DomainDoctor } from '@/components/dashboard/domain-doctor';
import { slugIndex } from '@/lib/api/adapters';
import { errorMessage } from '@/lib/api/errors';
import { FieldError, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/** A registrable hostname: labels of letters/digits/hyphens, at least one dot. */
const HOST_RULE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/domains')({
  component: DomainsPage,
  validateSearch: (
    raw: Record<string, unknown>
  ): Record<string, unknown> & {
    q?: string;
    status?: 'pending' | 'verified';
    doctor?: string;
  } => ({
    ...raw,
    q: typeof raw.q === 'string' && raw.q.trim() ? raw.q : undefined,
    status: raw.status === 'pending' || raw.status === 'verified' ? raw.status : undefined,
    doctor: typeof raw.doctor === 'string' && HOST_RULE.test(raw.doctor) ? raw.doctor : undefined,
  }),
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
  const appQuery = useApps();
  const apps = appQuery.data;
  const addDomain = useAddDomain();
  const deleteDomain = useDeleteDomain();
  const verifyDomain = useVerifyDomain();

  // Which domain the doctor panel is reporting on. Null closes it; the panel
  // sits under the table rather than in a dialog so the TXT record above stays
  // readable while the remediation is being applied.
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const doctorFor = search.doctor;
  const select = (patch: Partial<typeof search>, replace = false) =>
    void navigate({
      search: (current) => ({ ...current, ...patch }),
      hash: true,
      replace,
      resetScroll: false,
    });
  const setDoctorFor = (doctor?: string) => select({ doctor });
  const hostInput = useRef<HTMLInputElement>(null);

  const [host, setHost] = useState('');
  const [appSlug, setAppSlug] = useState('');
  const validation = useFormValidation<'host'>();
  const hostOk = HOST_RULE.test(host.trim());
  const hostError = hostOk ? undefined : 'Enter a full hostname, like api.example.com.';
  const showHostError = validation.submitAttempted ? hostError : undefined;

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
      priority: 'secondary',
      render: (d) => <span className="font-mono text-xs text-muted-foreground">{d.app}</span>,
    },
    {
      key: 'txtRecord',
      label: 'TXT record',
      priority: 'secondary',
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
      priority: 'secondary',
      numeric: true,
      render: (d) => formatDate(d.verifiedAt),
    },
    {
      key: 'id',
      label: '',
      width: 'w-56',
      render: (d) => (
        <div className="flex items-center justify-end gap-1.5">
          {!d.verified && (
            <Button
              size="sm"
              variant="secondary"
              busy={verifyDomain.isPending && verifyDomain.variables === d.domain}
              onClick={() => {
                void verifyDomain
                  .mutateAsync(d.domain)
                  .then((row) =>
                    toast(
                      row.verified
                        ? { kind: 'success', title: `${d.domain} verified` }
                        : {
                            kind: 'info',
                            title: 'Not verified yet',
                            description: 'DNS has not propagated. Run the doctor to see why.',
                          }
                    )
                  )
                  .catch((err: unknown) =>
                    toast({
                      kind: 'error',
                      title: 'Could not verify',
                      description: errorMessage(err),
                    })
                  );
              }}
            >
              Verify
            </Button>
          )}

          <IconButton
            type="button"
            aria-label={`Diagnose ${d.domain}`}
            onClick={() => setDoctorFor(doctorFor === d.domain ? undefined : d.domain)}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Activity className="h-3.5 w-3.5" />
          </IconButton>

          <IconButton
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
                  toast({
                    kind: 'error',
                    title: 'Could not remove',
                    description: errorMessage(err),
                  })
                );
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash className="h-3.5 w-3.5" />
          </IconButton>
        </div>
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
        validation.resetValidation();
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
            if (!validation.validate({ host: hostError }, e.currentTarget) || addDomain.isPending)
              return;
            submit();
          }}
        >
          <label className="flex min-w-56 flex-1 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Hostname</span>
            <input
              ref={hostInput}
              name="host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              {...fieldErrorProps(showHostError, 'domain-host-error')}
              placeholder="api.example.com"
              className={cn(
                'h-10 rounded-lg border bg-background px-3 text-sm outline-none focus:border-brand',
                showHostError ? 'border-[color:var(--status-critical)]' : 'border-border'
              )}
            />
            {showHostError && <FieldError id="domain-host-error">{showHostError}</FieldError>}
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

          <Button
            type="submit"
            size="sm"
            className="gap-1.5"
            busy={addDomain.isPending}
            disabled={!apps?.length || Boolean(appQuery.error)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add domain
          </Button>
        </form>
        {appQuery.error && (
          <div className="mt-3">
            <InlinePhase
              phase={queryPhase({ error: appQuery.error })}
              error={appQuery.error}
              onRetry={() => void appQuery.refetch()}
            />
          </div>
        )}
      </Panel>

      <ResourceTable
        rows={
          search.status
            ? rows.filter((row) => row.verified === (search.status === 'verified'))
            : rows
        }
        columns={columns}
        initialSort={{ key: 'domain', dir: 'asc' }}
        searchKeys={['domain', 'app']}
        searchPlaceholder="Filter by hostname…"
        query={search.q ?? ''}
        onQueryChange={(q) => select({ q: q || undefined }, true)}
        filters={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Domain status
            <select
              className="rounded-md border border-border bg-card p-2"
              value={search.status ?? ''}
              onChange={(event) =>
                select({ status: (event.target.value as 'pending' | 'verified') || undefined })
              }
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
            </select>
          </label>
        }
        emptyMessage={rows.length ? 'No domains match these filters.' : 'No custom domains yet.'}
        emptyAction={
          rows.length ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => select({ q: undefined, status: undefined })}
            >
              Clear filters
            </Button>
          ) : appQuery.isPending || appQuery.error ? undefined : apps?.length ? (
            <Button
              size="sm"
              onClick={() => {
                hostInput.current?.scrollIntoView({ block: 'center' });
                hostInput.current?.focus();
              }}
            >
              Add your first domain
            </Button>
          ) : apps ? (
            <Button asChild size="sm">
              <Link to="/dashboard/workflows/new">Create an app</Link>
            </Button>
          ) : undefined
        }
        minWidth="min-w-[820px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />

      {doctorFor && (
        <Panel
          title={`Doctor — ${doctorFor}`}
          description="What the platform observes for this hostname right now."
          actions={
            <Button size="sm" variant="secondary" onClick={() => setDoctorFor()}>
              Close
            </Button>
          }
        >
          <DomainDoctor domain={doctorFor} />
        </Panel>
      )}
    </div>
  );
}
