import { Plus } from 'iconoir-react';
import { Select } from '@/components/ui/field';
import { DomainAddForm, isDomainName } from '@/components/dashboard/domain-add-form';
import { DomainDetailButton } from '@/components/dashboard/domain-detail';
import { DomainDoctor } from '@/components/dashboard/domain-doctor';
import { Sheet } from '@/components/dashboard/kit/sheet';
import { InlinePhase, PageHeader, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyIconButton } from '@/components/ui/copy-button';
import { IconButton } from '@/components/ui/icon-button';
import { Modal } from '@/components/ui/modal';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { slugIndex } from '@/lib/api/adapters';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { ApiError } from '@/lib/api/errors';
import {
  useAddDomain,
  useApps,
  useDeleteDomain,
  useDomains,
  useRetryDomain,
} from '@/lib/api/queries';
import { consoleHead } from '@/lib/seo';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Activity, Trash } from 'iconoir-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

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
    // A wildcard has a doctor too: it probes the wildcard's check host.
    doctor: typeof raw.doctor === 'string' && isDomainName(raw.doctor) ? raw.doctor : undefined,
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
  appId: string;
  /** Project environment the route is scoped to; carried through a re-add. */
  environment: string | null;
  verified: boolean;
  /** True when this domain is already its app's default. */
  isDefault: boolean;
  verifiedAt: string | null;
  txtRecord: string | null;
}

/** Re-read the domains this long after a retry is queued. */
const RECHECK_DELAYS_MS = [5_000, 20_000];

function DomainsPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error, refetch } = useDomains();
  const appQuery = useApps();
  const apps = appQuery.data;
  const addDomain = useAddDomain();
  const deleteDomain = useDeleteDomain();
  const retryDomain = useRetryDomain();
  // Hostnames whose TXT challenge the API refused to retry because it ran out.
  const [expired, setExpired] = useState<ReadonlySet<string>>(new Set());
  const [rearming, setRearming] = useState<string | null>(null);
  const [newRecord, setNewRecord] = useState<{ domain: string; txt: string } | null>(null);

  // Keep diagnostics shareable and restorable with browser Back/Forward.
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const doctorFor = search.doctor;
  // The doctor is a preview capability; off, there is nothing to open.
  const doctorAccess = useCapabilityAccess('domain-doctor').access;
  const select = (patch: Partial<typeof search>, replace = false) =>
    void navigate({
      search: (current) => ({ ...current, ...patch }),
      hash: true,
      replace,
      resetScroll: false,
    });
  const setDoctorFor = (doctor?: string) => select({ doctor });

  const [creating, setCreating] = useState(false);
  const rows = useMemo<DomainRow[]>(() => {
    const bySlug = slugIndex(apps ?? []);
    return (data ?? []).map((d) => ({
      // The API keys domains by hostname, not by a surrogate id.
      id: d.domain,
      domain: d.domain,
      app: bySlug.get(d.app_id) ?? d.app_id,
      appId: d.app_id,
      environment: d.environment ?? null,
      verified: d.verified,
      isDefault: d.default === true,
      verifiedAt: d.verified_at ?? null,
      txtRecord: d.txt_record ?? null,
    }));
  }, [data, apps]);

  // After a retry is queued the poller runs on its own schedule, so look again
  // a little later rather than leaving the row looking unchanged.
  const recheckTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearRechecks = () => {
    recheckTimers.current.forEach(clearTimeout);
    recheckTimers.current = [];
  };
  useEffect(() => clearRechecks, []);

  const markExpired = (domain: string, on: boolean) =>
    setExpired((prev) => {
      const next = new Set(prev);
      if (on) next.add(domain);
      else next.delete(domain);
      return next;
    });

  /**
   * Retry only works while the challenge is unexpired. It answers 409 for an
   * expired challenge and for a domain that is already verified (the code is the
   * generic `validation_failed`, so the status is what tells it apart), and the
   * two need opposite words, so the domains are re-read to see which it was.
   */
  const checkAgain = async (domain: string) => {
    try {
      await retryDomain.mutateAsync(domain);
      toast({
        kind: 'info',
        title: 'Checking again',
        description: 'The TXT record will be looked up again shortly.',
      });
      clearRechecks();
      recheckTimers.current = RECHECK_DELAYS_MS.map((ms) => setTimeout(() => void refetch(), ms));
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) {
        toast({ kind: 'error', title: 'Could not check again', error: err });
        return;
      }
      // A failed refetch keeps the previous data, so check the error, not the rows.
      const fresh = await refetch().catch(() => undefined);
      if (!fresh || fresh.isError) {
        toast({
          kind: 'error',
          title: 'Could not read the domain’s state',
          description: 'Reload the list to see whether it verified or expired.',
        });
        return;
      }
      const row = fresh.data?.find((x) => x.domain === domain);
      if (!row) {
        toast({ kind: 'info', title: `${domain} is no longer listed` });
        return;
      }
      if (row.verified) {
        toast({ kind: 'success', title: `${domain} verified` });
      } else {
        markExpired(domain, true);
        toast({
          kind: 'info',
          title: 'This verification expired',
          description: 'Get a new TXT record, publish it, then check again.',
        });
      }
    }
  };

  /** Adding the same domain and app again re-arms an expired challenge with a new token. */
  const getNewRecord = async (row: DomainRow) => {
    setRearming(row.domain);
    try {
      const created = await addDomain.mutateAsync({
        domain: row.domain,
        app_id: row.appId,
        ...(row.environment ? { environment: row.environment } : {}),
      });
      const dns = created.dns_records?.find(
        (r) => r.type === 'TXT' && r.purpose === 'verification'
      );
      const txt = created.txt_record ?? (dns ? `${dns.name} TXT "${dns.value}"` : null);
      markExpired(row.domain, false);
      if (txt) setNewRecord({ domain: row.domain, txt });
      else toast({ kind: 'success', title: 'Verification restarted' });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not get a new TXT record',
        error: err,
      });
    } finally {
      setRearming(null);
    }
  };

  const columns: Column<DomainRow>[] = [
    {
      key: 'domain',
      label: 'Domain',
      // One line from md up. On a phone the column is narrow, so the name may
      // break, but only before a dot, never mid-label. The default pill is stacked
      // under the hostname so it does not squeeze an already narrow column.
      render: (d) => (
        <span className="flex flex-col items-start gap-1">
          <span className="font-mono [overflow-wrap:normal] md:whitespace-nowrap md:[&_wbr]:hidden">
            {d.domain.split('.').map((label, i) => (
              <Fragment key={i}>
                {i > 0 && <wbr />}
                {i > 0 && '.'}
                {label}
              </Fragment>
            ))}
          </span>
          {d.isDefault && <Pill label="default" />}
        </span>
      ),
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
      // An environment-bound domain names its environment under the app.
      render: (d) => (
        <span className="flex flex-col items-start gap-1">
          <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{d.app}</span>
          {d.environment && <Pill label={d.environment} />}
        </span>
      ),
    },
    {
      key: 'txtRecord',
      label: 'TXT record',
      priority: 'secondary',
      render: (d) =>
        d.verified ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : expired.has(d.domain) ? (
          <span className="text-xs" style={{ color: 'var(--status-warning)' }}>
            This verification expired. Get a new TXT record, then publish that value instead.
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <code className="select-all text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {d.txtRecord ?? '—'}
            </code>
            {d.txtRecord && (
              <CopyIconButton text={d.txtRecord} label={`TXT record ${d.txtRecord}`} />
            )}
          </span>
        ),
    },
    {
      key: 'verifiedAt',
      label: 'Verified',
      priority: 'secondary',
      numeric: true,
      render: (d) => <Timestamp value={d.verifiedAt} />,
    },
    {
      key: 'id',
      label: '',
      // As wide as its controls. On a phone they wrap, so the icons drop
      // below a recovery button instead of running off the card.
      width: 'md:w-0',
      render: (d) => (
        <div className="flex flex-wrap items-center justify-end gap-1.5 md:flex-nowrap">
          {!d.verified &&
            (expired.has(d.domain) ? (
              <Button
                size="sm"
                variant="secondary"
                // The longest control in the cell: on a phone its label wraps
                // rather than pushing the row wider than the card.
                className="h-auto min-h-8 shrink whitespace-normal py-1 md:h-8 md:whitespace-nowrap"
                busy={rearming === d.domain}
                onClick={() => void getNewRecord(d)}
              >
                Get a new TXT record
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                busy={retryDomain.isPending && retryDomain.variables === d.domain}
                onClick={() => void checkAgain(d.domain)}
              >
                Check again
              </Button>
            ))}

          <DomainDetailButton domain={d.domain} />
          {doctorAccess !== 'off' && (
            <IconButton
              type="button"
              aria-label={`Diagnose ${d.domain}`}
              onClick={() => setDoctorFor(doctorFor === d.domain ? undefined : d.domain)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              <Activity className="h-3.5 w-3.5" />
            </IconButton>
          )}

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
                    error: err,
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Domains"
        help="TLS is issued and renewed automatically once a domain verifies."
        actions={
          <Button
            size="sm"
            disabled={!apps?.length || Boolean(appQuery.error)}
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Add domain
          </Button>
        }
      />

      {appQuery.error && (
        <InlinePhase
          phase={queryPhase({ error: appQuery.error })}
          error={appQuery.error}
          onRetry={() => void appQuery.refetch()}
        />
      )}
      <Sheet open={creating} onClose={() => setCreating(false)} title="Add domain">
        <DomainAddForm onCreated={() => setCreating(false)} />
      </Sheet>

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
            <Select
              className="surface rounded-[1.25rem] bg-card p-2"
              value={search.status ?? ''}
              onChange={(event) =>
                select({ status: (event.target.value as 'pending' | 'verified') || undefined })
              }
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
            </Select>
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
            <Button size="sm" onClick={() => setCreating(true)}>
              Add your first domain
            </Button>
          ) : apps ? (
            <Button asChild size="sm">
              <Link to="/dashboard/apps/new">Create an app</Link>
            </Button>
          ) : undefined
        }
        minWidth="min-w-[820px]"
        loading={isPending}
        error={error}
        onRetry={() => void refetch()}
      />

      {newRecord && (
        <Modal
          open
          onClose={() => setNewRecord(null)}
          width="max-w-xl"
          title={`New TXT record for ${newRecord.domain}`}
          description="The previous value no longer works. Publish this one, then check again. It is valid for seven days."
        >
          <div className="flex flex-col gap-3 p-1">
            <div className="flex items-start gap-2">
              <code className="select-all break-all rounded-md bg-muted px-2 py-1.5 text-xs">
                {newRecord.txt}
              </code>
              <CopyIconButton text={newRecord.txt} label="TXT record" />
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setNewRecord(null)}>
                Done
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {doctorFor && (
        <Modal
          open
          onClose={() => setDoctorFor()}
          width="max-w-2xl"
          title={`Doctor — ${doctorFor}`}
        >
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-1">
            <DomainDoctor domain={doctorFor} />
          </div>
        </Modal>
      )}
    </div>
  );
}
