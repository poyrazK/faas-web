import { Select } from '@/components/ui/field';
import { DomainAddForm, isDomainName } from '@/components/dashboard/domain-add-form';
import { DomainDetailButton } from '@/components/dashboard/domain-detail';
import { DomainDoctor } from '@/components/dashboard/domain-doctor';
import { DnsRecordList, Reveal, StatusWord } from '@/components/dashboard/domain-records';
import {
  describeDomain,
  routingRecords,
  summarizeDomains,
  verificationRecord,
  type DomainWords,
  type RecordRow,
} from '@/components/dashboard/domain-words';
import { Sheet } from '@/components/dashboard/kit/sheet';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  LoadingState,
  PageHeader,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { inScope, useProjectScope } from '@/lib/project-scope';
import { consoleHead } from '@/lib/seo';
import { cn } from '@/lib/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Activity, MoreHoriz, Plus, Search, Trash } from 'iconoir-react';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';

export const Route = createFileRoute('/dashboard/domains')({
  component: DomainsPage,
  validateSearch: (
    raw: Record<string, unknown>
  ): Record<string, unknown> & {
    q?: string;
    status?: 'pending' | 'verified';
    doctor?: string;
    add?: true;
  } => ({
    ...raw,
    q: typeof raw.q === 'string' && raw.q.trim() ? raw.q : undefined,
    status: raw.status === 'pending' || raw.status === 'verified' ? raw.status : undefined,
    // A wildcard has a doctor too: it probes the wildcard's check host.
    doctor: typeof raw.doctor === 'string' && isDomainName(raw.doctor) ? raw.doctor : undefined,
    // Other pages (an app's Routes tab) open the add form directly.
    add:
      raw.add === true || raw.add === 'true' || raw.add === 1 || raw.add === '1' ? true : undefined,
  }),
  head: () => consoleHead('domains'),
});

/**
 * Custom hostnames, from `/v1/domains`, in plain words
 * (docs/console-plain-english.md).
 *
 * The page opens with one sentence saying how many domains are live and what
 * is waiting. Each domain is a card with one status word and, when something
 * is needed, the one step that fixes it — for a new domain, the TXT record to
 * publish, which is the whole point of the page for it, so it is shown in
 * place rather than behind the detail. Certificate facts, the doctor and
 * removal sit behind Details and the card's menu.
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
  txt: RecordRow | null;
  routing: { main: RecordRow[]; alternatives: RecordRow[] };
  words: DomainWords;
}

/** Re-read the domains this long after a retry is queued. */
const RECHECK_DELAYS_MS = [5_000, 20_000];

/** Fewer domains than this read at a glance; a filter row would only be noise. */
const FILTER_FROM = 6;

function DomainsPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { data, isPending, error, refetch } = useDomains();
  const appQuery = useApps();
  // Inside a project, only the domains routing to its apps. A domain names its
  // app by id, so the apps must be known before a row can be placed; until
  // then (and until the project's membership loads) the page keeps loading
  // rather than flash every domain on the account.
  const scope = useProjectScope();
  const scopeLoading =
    Boolean(scope.project) && ((scope.appSlugs === null && !scope.settled) || appQuery.isPending);
  const apps = appQuery.data && inScope(appQuery.data, scope, (app) => app.slug);
  const addDomain = useAddDomain();
  const deleteDomain = useDeleteDomain();
  const retryDomain = useRetryDomain();
  // Hostnames whose TXT challenge the API refused to retry because it ran out.
  const [expired, setExpired] = useState<ReadonlySet<string>>(new Set());
  const [rearming, setRearming] = useState<string | null>(null);
  const [newRecord, setNewRecord] = useState<{ domain: string; record: RecordRow } | null>(null);
  // Each card's ⋯ trigger, so focus returns to it after the doctor or a confirm.
  const triggers = useRef(new Map<string, HTMLButtonElement>());

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

  // Closing the doctor hands focus back to the card it was opened from.
  const lastDoctor = useRef(doctorFor);
  useEffect(() => {
    const previous = lastDoctor.current;
    lastDoctor.current = doctorFor;
    if (previous && !doctorFor) triggers.current.get(previous)?.focus();
  }, [doctorFor]);

  const [creatingHere, setCreating] = useState(false);
  const creating = creatingHere || search.add === true;
  const closeCreate = () => {
    setCreating(false);
    if (search.add) select({ add: undefined }, true);
  };

  const rows = useMemo<DomainRow[]>(() => {
    const bySlug = slugIndex(appQuery.data ?? []);
    const scoped = inScope(data ?? [], scope, (d) => bySlug.get(d.app_id) ?? '');
    return scoped.map((d) => {
      const app = bySlug.get(d.app_id) ?? d.app_id;
      return {
        // The API keys domains by hostname, not by a surrogate id.
        id: d.domain,
        domain: d.domain,
        app,
        appId: d.app_id,
        environment: d.environment ?? null,
        verified: d.verified,
        isDefault: d.default === true,
        verifiedAt: d.verified_at ?? null,
        txt: verificationRecord(d),
        routing: routingRecords(d),
        words: describeDomain(d, { app, expired: expired.has(d.domain) }),
      };
    });
  }, [data, appQuery.data, scope, expired]);

  // After a retry is queued the poller runs on its own schedule, so look again
  // a little later rather than leaving the card looking unchanged.
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
      const record = verificationRecord(created);
      markExpired(row.domain, false);
      if (record) setNewRecord({ domain: row.domain, record });
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

  const remove = async (domain: string) => {
    const ok = await confirm({
      title: `Remove ${domain}?`,
      description:
        'Traffic to this hostname stops routing here immediately. The DNS record can stay.',
      confirmLabel: 'Remove domain',
      destructive: true,
    });
    triggers.current.get(domain)?.focus();
    if (!ok) return;
    void deleteDomain
      .mutateAsync(domain)
      .then(() => toast({ kind: 'success', title: `Removed ${domain}` }))
      .catch((err: unknown) =>
        toast({
          kind: 'error',
          title: 'Could not remove',
          error: err,
        })
      );
  };

  const phase = queryPhase({ error, loading: isPending || scopeLoading });
  const canAdd = Boolean(apps?.length) && !appQuery.error;
  const query = search.q ?? '';
  const visible = rows
    .filter((row) => !search.status || row.verified === (search.status === 'verified'))
    .filter((row) => {
      const q = query.trim().toLowerCase();
      return !q || row.domain.toLowerCase().includes(q) || row.app.toLowerCase().includes(q);
    })
    // What needs doing first, then by hostname.
    .sort(
      (a, b) => Number(!a.words.step) - Number(!b.words.step) || a.domain.localeCompare(b.domain)
    );
  const filtering = Boolean(search.q || search.status);
  const answer = summarizeDomains(rows.map((row) => row.words.state));

  const firstAction =
    appQuery.isPending || appQuery.error ? undefined : apps?.length ? (
      <Button size="sm" onClick={() => setCreating(true)}>
        Add your first domain
      </Button>
    ) : apps ? (
      <Button asChild size="sm">
        <Link to="/dashboard/apps/new">Create an app</Link>
      </Button>
    ) : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Domains"
        help="Serve an app at your own address. HTTPS certificates are issued and renewed automatically once a domain verifies."
        actions={
          <Button size="sm" disabled={!canAdd} onClick={() => setCreating(true)}>
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
      <Sheet open={creating} onClose={closeCreate} title="Add domain">
        <DomainAddForm onCreated={closeCreate} />
      </Sheet>

      {phase === 'ready' && rows.length > 0 && (
        <section
          aria-label="Domains at a glance"
          className="well flex flex-col gap-1 rounded-2xl bg-muted/40 px-5 py-5 sm:px-6"
        >
          <p className="text-xl leading-7 font-medium tracking-[-0.01em] text-balance">
            {answer.lead}
          </p>
          {answer.rest && <p className="text-sm text-muted-foreground">{answer.rest}</p>}
        </section>
      )}

      {/* Kept through loading when the URL carries a filter, so it can be read and changed. */}
      {(rows.length >= FILTER_FROM || filtering) && (
        <Filters
          query={query}
          status={search.status}
          onQuery={(q) => select({ q: q || undefined }, true)}
          onStatus={(status) => select({ status })}
        />
      )}

      {phase === 'unreachable' ? (
        <UnreachableState onRetry={() => void refetch()} />
      ) : phase === 'error' ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : phase === 'loading' ? (
        <LoadingState message="Loading domains…" />
      ) : rows.length === 0 ? (
        <EmptyState
          message={
            scope.project
              ? `No custom domains in ${scope.label} yet. Add one to serve one of its apps at your own address.`
              : 'No custom domains yet. Add one to serve an app at your own address.'
          }
          action={firstAction}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          message="No domains match these filters."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => select({ q: undefined, status: undefined })}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <ul aria-label="Custom domains" className="grid gap-3 md:grid-cols-2">
          {visible.map((row) => (
            // A domain with a step to take gets the full width; calm ones pair up.
            <li key={row.id} className={cn('flex', row.words.step && 'md:col-span-2')}>
              <DomainCard
                row={row}
                checking={retryDomain.isPending && retryDomain.variables === row.domain}
                renewing={rearming === row.domain}
                onCheckAgain={() => void checkAgain(row.domain)}
                onRenew={() => void getNewRecord(row)}
                onDiagnose={doctorAccess === 'off' ? undefined : () => setDoctorFor(row.domain)}
                onRemove={() => void remove(row.domain)}
                triggerRef={(el) => {
                  if (el) triggers.current.set(row.domain, el);
                  else triggers.current.delete(row.domain);
                }}
              />
            </li>
          ))}
        </ul>
      )}

      {newRecord && (
        <Modal
          open
          onClose={() => setNewRecord(null)}
          width="max-w-xl"
          title={`New TXT record for ${newRecord.domain}`}
          description="The previous value no longer works. Publish this one at your DNS provider, then check again. It is valid for seven days."
        >
          <div className="flex flex-col gap-3 p-1">
            <DnsRecordList records={[newRecord.record]} label="New TXT record" purpose={false} />
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
          title={`Diagnose ${doctorFor}`}
        >
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-1">
            <DomainDoctor domain={doctorFor} />
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Search and verification filter, both kept in the URL. */
function Filters({
  query,
  status,
  onQuery,
  onStatus,
}: {
  query: string;
  status?: 'pending' | 'verified';
  onQuery: (q: string) => void;
  onStatus: (status?: 'pending' | 'verified') => void;
}) {
  const searchId = useId();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <label htmlFor={searchId} className="relative flex min-w-0 flex-1 items-center sm:max-w-sm">
        <span className="sr-only">Filter by hostname or app</span>
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground"
        />
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Filter by hostname or app…"
          className="h-9 w-full rounded-lg border border-border bg-background pr-3 pl-8 text-sm outline-none focus:border-brand"
        />
      </label>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        Domain status
        <Select
          className="surface rounded-[1.25rem] bg-card p-2"
          value={status ?? ''}
          onChange={(event) =>
            onStatus((event.target.value as 'pending' | 'verified') || undefined)
          }
        >
          <option value="">All domains</option>
          <option value="pending">Not verified</option>
          <option value="verified">Verified</option>
        </Select>
      </label>
    </div>
  );
}

/** A hostname that breaks only before a dot, never mid-label. */
function Hostname({ domain }: { domain: string }) {
  return (
    <>
      {domain.split('.').map((label, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {i > 0 && '.'}
          {label}
        </Fragment>
      ))}
    </>
  );
}

const CHIP =
  'inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs text-muted-foreground';

/**
 * One domain: its hostname, one status word, one sentence, the one step when
 * something is needed, then the facts. Details opens the full record; the ⋯
 * menu holds the doctor and removal.
 */
function DomainCard({
  row,
  checking,
  renewing,
  onCheckAgain,
  onRenew,
  onDiagnose,
  onRemove,
  triggerRef,
}: {
  row: DomainRow;
  checking: boolean;
  renewing: boolean;
  onCheckAgain: () => void;
  onRenew: () => void;
  /** Absent when the doctor is not available to this account. */
  onDiagnose?: () => void;
  onRemove: () => void;
  triggerRef: (el: HTMLButtonElement | null) => void;
}) {
  const nameId = useId();
  const { words } = row;
  // A menu item that opens a dialog keeps Radix from pulling focus back out of it.
  const openingDialog = useRef(false);
  const tint =
    words.tone === 'critical' || words.tone === 'warning'
      ? {
          background: `radial-gradient(90% 80% at 100% 0%, color-mix(in oklab, var(--status-${words.tone}) ${words.tone === 'critical' ? 10 : 7}%, transparent), transparent 65%), var(--card)`,
        }
      : undefined;
  return (
    <article
      aria-labelledby={nameId}
      className="surface flex w-full flex-col gap-3 rounded-[1.25rem] bg-card p-5 sm:p-6"
      style={tint}
    >
      <div className="flex items-start justify-between gap-3">
        <h3
          id={nameId}
          className="min-w-0 font-mono text-[15px] leading-6 font-semibold [overflow-wrap:normal]"
        >
          <Hostname domain={row.domain} />
        </h3>
        <StatusWord word={words.word} tone={words.tone} title={words.term} className="pt-0.5" />
      </div>
      <p className="text-[15px] leading-6 text-foreground/85" title={words.term}>
        {words.sentence}
      </p>

      {words.step && (
        <NextStep
          row={row}
          checking={checking}
          renewing={renewing}
          onCheckAgain={onCheckAgain}
          onRenew={onRenew}
          onDiagnose={onDiagnose}
        />
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <ul aria-label="Facts" className="flex min-w-0 flex-wrap items-center gap-1.5">
          <li className={CHIP} title="The app this domain routes to">
            <span aria-hidden className="mr-1">
              →
            </span>
            <span className="font-mono">{row.app}</span>
          </li>
          {row.environment && (
            <li className={CHIP} title="Project environment this domain routes to">
              {row.environment} only
            </li>
          )}
          {row.isDefault && (
            <li
              className={cn(CHIP, 'text-foreground')}
              title="Default domain: the console, CLI and API link to the app with this address"
            >
              Main address
            </li>
          )}
          {row.verifiedAt && (
            <li className="px-1 text-xs text-muted-foreground">
              Verified <Timestamp value={row.verifiedAt} />
            </li>
          )}
        </ul>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <DomainDetailButton domain={row.domain} />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              ref={triggerRef}
              aria-label={`More actions for ${row.domain}`}
              className="pressable flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
            >
              <MoreHoriz aria-hidden="true" className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                if (!openingDialog.current) return;
                openingDialog.current = false;
                event.preventDefault();
              }}
            >
              {onDiagnose && (
                <DropdownMenuItem
                  onSelect={() => {
                    openingDialog.current = true;
                    onDiagnose();
                  }}
                >
                  <Activity aria-hidden="true" className="size-4" />
                  Diagnose DNS and HTTPS
                </DropdownMenuItem>
              )}
              {onDiagnose && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onSelect={() => {
                  openingDialog.current = true;
                  onRemove();
                }}
                className="data-[highlighted]:text-[color:var(--status-critical)]"
              >
                <Trash aria-hidden="true" className="size-4" />
                Remove domain
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </article>
  );
}

/** The one plain next step, with the records it needs and the button that follows it. */
function NextStep({
  row,
  checking,
  renewing,
  onCheckAgain,
  onRenew,
  onDiagnose,
}: {
  row: DomainRow;
  checking: boolean;
  renewing: boolean;
  onCheckAgain: () => void;
  onRenew: () => void;
  onDiagnose?: () => void;
}) {
  const { step } = row.words;
  const { main, alternatives } = row.routing;
  const checkAgain = (
    <Button size="sm" busy={checking} onClick={onCheckAgain}>
      Check again
    </Button>
  );
  const apex = alternatives.length > 0 && (
    <Reveal show="Show records for a zone apex" hide="Hide records for a zone apex">
      <DnsRecordList records={alternatives} label={`Zone apex records for ${row.domain}`} />
    </Reveal>
  );

  let title: string;
  let body: ReactNode = null;
  let action: ReactNode;
  let note: string | null = null;
  switch (step) {
    case 'publish': {
      const records = [...(row.txt ? [row.txt] : []), ...main];
      title =
        main.length > 0
          ? 'Add these records at your DNS provider'
          : 'Add this TXT record at your DNS provider';
      body = (
        <>
          <DnsRecordList records={records} label={`Records to add for ${row.domain}`} />
          {apex}
        </>
      );
      action = checkAgain;
      note = 'Gregale also keeps checking on its own.';
      break;
    }
    case 'renew':
      title = 'Get a new TXT record, then publish that value instead';
      action = (
        <Button
          size="sm"
          busy={renewing}
          // On a phone its label wraps rather than pushing the card wider.
          className="h-auto min-h-8 whitespace-normal py-1"
          onClick={onRenew}
        >
          Get a new TXT record
        </Button>
      );
      break;
    case 'repoint': {
      const records = [...main, ...(row.txt ? [row.txt] : [])];
      title = 'Point this domain back at Gregale, then check again';
      body =
        records.length > 0 ? (
          <>
            <DnsRecordList records={records} label={`Records to restore for ${row.domain}`} />
            {apex}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Details lists the records to publish.</p>
        );
      action = row.txt ? checkAgain : null;
      break;
    }
    case 'diagnose':
      title = 'Find out what is blocking HTTPS';
      action = onDiagnose ? (
        <Button size="sm" variant="outline" onClick={onDiagnose}>
          <Activity className="h-3.5 w-3.5" />
          Diagnose
        </Button>
      ) : null;
      note = onDiagnose
        ? 'Checks its DNS and certificate and names the record to change.'
        : 'Details shows the last error.';
      break;
    default:
      return null;
  }

  return (
    <div className="well flex flex-col gap-3 rounded-xl bg-muted/40 p-4">
      <p className="text-sm font-medium">{title}</p>
      {body}
      {(action || note) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {action}
          {note && <span className="text-xs text-muted-foreground">{note}</span>}
        </div>
      )}
    </div>
  );
}
