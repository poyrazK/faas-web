import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { LogOut } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { InlinePhase, PageHeader, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import {
  useApps,
  useRevokeAllSessions,
  useRevokeSession,
  useSessions,
  useAuthAuditEvents,
  useAccountSecrets,
} from '@/lib/api/queries';
import { auditQuery, DEFAULT_AUDIT_FILTERS } from '@/lib/audit-filters';
import { AuditEventDrawer } from '@/components/dashboard/audit-event-drawer';
import { useMfa } from '@/components/auth/mfa-provider';
import { errorMessage } from '@/lib/api/errors';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/security')({
  component: SecurityPage,
  head: () => consoleHead('security'),
});

/**
 * Active dashboard sessions, from `/v1/auth/sessions`.
 *
 * The point of the page is the panic button: someone who thinks their account
 * is compromised needs to end every other session in one action, without
 * hunting through rows. Revoking all is therefore the primary control, and the
 * current session is marked so it is obvious what "all" includes.
 *
 * Both writes obtain an action-bound CSRF token from the API. The matching
 * cookie is HttpOnly, so the browser never needs to read it directly.
 */
interface SessionRow {
  id: string;
  ip: string;
  agent: string;
  issuedAt: string;
  lastSeenAt: string;
  current: boolean;
}

function formatWhen(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

const AUDIT_FIELD =
  'h-8 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none focus:border-brand/50';

function AuthEventsPanel() {
  const [filters, setFilters] = useState(DEFAULT_AUDIT_FILTERS);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useAuthAuditEvents(auditQuery(filters));
  const { data: apps } = useApps();
  const events = q.data?.events ?? [];
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: events.length === 0 });
  const set = <K extends keyof typeof filters>(k: K, v: (typeof filters)[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));
  return (
    <Panel
      title="Audit events"
      description="Sign-ins, key mints, MFA changes and state transitions — the account's security timeline, distinct from the resource audit log. Click a row for the full payload."
      padded={false}
    >
      {/* The CLI's audit filters: since / kind prefix / limit / app. */}
      <div className="flex flex-wrap items-end gap-3 border-b border-border px-5 py-3">
        <label className="flex flex-col gap-1">
          <span className="label-mono text-muted-foreground">Since</span>
          <input
            aria-label="Since"
            type="datetime-local"
            value={filters.since}
            onChange={(e) => set('since', e.target.value)}
            className={AUDIT_FIELD}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label-mono text-muted-foreground">Kind prefix</span>
          <input
            aria-label="Kind prefix"
            value={filters.kind_prefix}
            onChange={(e) => set('kind_prefix', e.target.value)}
            placeholder="auth."
            className={AUDIT_FIELD}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label-mono text-muted-foreground">Limit</span>
          <select
            aria-label="Limit"
            value={filters.limit}
            onChange={(e) => set('limit', Number(e.target.value))}
            className={AUDIT_FIELD}
          >
            {[50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label-mono text-muted-foreground">App</span>
          <select
            aria-label="App"
            value={filters.app_id}
            onChange={(e) => set('app_id', e.target.value)}
            className={AUDIT_FIELD}
          >
            <option value="">Any</option>
            {(apps ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.slug}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-xs">
          <input
            type="checkbox"
            checked={filters.include_anonymous}
            onChange={(e) => set('include_anonymous', e.target.checked)}
          />
          Include anonymous
        </label>
      </div>
      {phase !== 'ready' ? (
        <div className="px-5 py-3">
          <InlinePhase
            phase={phase}
            error={q.error}
            loadingMessage="Reading audit events…"
            emptyMessage="No audit events match these filters."
          />
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {events.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                onClick={() => setOpenId(e.id)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-left text-xs transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <span className="font-mono">{e.kind}</span>
                <span className="text-muted-foreground">{e.actor}</span>
                {e.severity && e.severity !== 'info' && (
                  <span
                    style={{
                      color:
                        e.severity === 'high' ? 'var(--status-critical)' : 'var(--status-warning)',
                    }}
                  >
                    {e.severity}
                  </span>
                )}
                <span className="ml-auto text-muted-foreground">
                  {new Date(e.at).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <AuditEventDrawer id={openId} onClose={() => setOpenId(null)} />
    </Panel>
  );
}

/** Every sealed secret across the account — the hygiene inventory, so a
 * stale credential is findable without opening each app. */
function SecretsInventoryPanel() {
  const q = useAccountSecrets();
  const rows = q.data?.secrets ?? [];
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: rows.length === 0 });
  return (
    <Panel
      title="Sealed secrets"
      description="Across every app. Values are sealed — this lists names and ages only."
      padded={phase !== 'ready'}
    >
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage="Reading the inventory…"
          emptyMessage="No sealed secrets on this account."
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((r) => (
            <li
              key={`${r.app_slug}/${r.key}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-xs"
            >
              <span className="font-mono">{r.app_slug}</span>
              <span className="font-mono text-muted-foreground">{r.key}</span>
              <span className="ml-auto text-muted-foreground">
                updated {new Date(r.updated_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SecurityPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { openMfa } = useMfa();
  const { data, isPending, error, refetch } = useSessions();
  const revoke = useRevokeSession();
  const revokeAll = useRevokeAllSessions();

  const rows = useMemo<SessionRow[]>(
    () =>
      (data?.sessions ?? []).map((s) => ({
        id: s.id,
        ip: s.issued_ip ?? '—',
        agent: s.issued_ua ?? '—',
        issuedAt: s.issued_at,
        lastSeenAt: s.last_seen_at ?? '',
        current: s.current_session,
      })),
    [data]
  );

  const columns: Column<SessionRow>[] = [
    {
      key: 'ip',
      label: 'IP',
      width: 'w-40',
      render: (s) => (
        <span className="flex items-center gap-2">
          <span className="font-mono text-xs">{s.ip}</span>
          {s.current && <Pill label="this device" color="var(--brand)" />}
        </span>
      ),
    },
    {
      key: 'agent',
      label: 'Browser',
      render: (s) => (
        <span className="line-clamp-1 text-xs text-muted-foreground" title={s.agent}>
          {s.agent}
        </span>
      ),
    },
    {
      key: 'issuedAt',
      label: 'Signed in',
      numeric: true,
      render: (s) => (
        <span className="text-xs text-muted-foreground">{formatWhen(s.issuedAt)}</span>
      ),
    },
    {
      key: 'lastSeenAt',
      label: 'Last seen',
      numeric: true,
      render: (s) => (
        <span className="text-xs text-muted-foreground">{formatWhen(s.lastSeenAt)}</span>
      ),
    },
    {
      key: 'id',
      label: '',
      width: 'w-24',
      render: (s) =>
        s.current ? null : (
          <button
            type="button"
            onClick={async () => {
              if (
                !(await confirm({
                  title: 'Revoke this session?',
                  description: 'That browser is signed out on its next request.',
                  confirmLabel: 'Revoke session',
                  destructive: true,
                }))
              )
                return;
              void revoke
                .mutateAsync(s.id)
                .then(() => toast({ kind: 'success', title: 'Session revoked' }))
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not revoke',
                    description: errorMessage(err),
                  })
                );
            }}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Revoke
          </button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security"
        description="Every browser signed in to this account. Revoke anything you do not recognise."
        actions={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={revokeAll.isPending}
            onClick={async () => {
              if (
                !(await confirm({
                  title: 'Sign out everywhere?',
                  description:
                    'Every other browser and CLI session ends. This one stays signed in.',
                  confirmLabel: 'Sign out everywhere',
                  destructive: true,
                }))
              )
                return;
              void revokeAll
                .mutateAsync()
                .then((result) =>
                  toast({
                    kind: 'success',
                    title: 'Sessions revoked',
                    description: `${result.revoked} session${result.revoked === 1 ? '' : 's'} ended.`,
                  })
                )
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not revoke',
                    description: errorMessage(err),
                  })
                );
            }}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out everywhere
          </Button>
        }
      />

      <Panel
        title="Multi-factor authentication"
        description="Optional extra protection for your dashboard account."
        actions={
          <Button size="sm" variant="outline" onClick={() => openMfa('choose')}>
            Set up or verify
          </Button>
        }
      >
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Manage the authenticator step for this browser session. If MFA is already enabled, you can
          verify it here; if it is not, Gregale will guide you through optional enrollment and
          provide one-time recovery codes.
        </p>
      </Panel>

      <Panel title="Active sessions">
        <ResourceTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'lastSeenAt', dir: 'desc' }}
          searchKeys={['ip', 'agent']}
          searchPlaceholder="Filter by IP or browser…"
          emptyMessage="No other sessions."
          minWidth="min-w-[900px]"
          loading={isPending}
          error={error}
          onRetry={() => void refetch()}
        />
      </Panel>
      <SecretsInventoryPanel />
      <AuthEventsPanel />
    </div>
  );
}
