import { useMemo, useState } from 'react';
import { LogOut, ShieldCheck } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import {
  useRevokeAllSessions,
  useRevokeSession,
  useSessions,
  useAuthAuditEvents,
  useAccountSecrets,
} from '@/lib/api/queries';
import { useMfa } from '@/components/auth/mfa-provider';
import { PasswordPanel } from '@/components/dashboard/password-wizard';
import { AuthEventDetail } from '@/components/dashboard/auth-event-detail';
import { Timestamp } from '@/components/ui/timestamp';
import { Disclosure, SettingsSummary } from '@/components/dashboard/settings-kit';
import {
  actorWords,
  authEventWords,
  deviceWords,
  securitySummary,
  type AuthEventWords,
} from '@/components/dashboard/settings-words';

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
  device: string;
  issuedAt: string;
  lastSeenAt: string;
  current: boolean;
}

const TONE_COLOR: Record<AuthEventWords['tone'], string | undefined> = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  neutral: undefined,
};

/** How many events show before "Show all". */
const FIRST_EVENTS = 6;

/**
 * The auth audit trail (`/v1/audit-events`) in plain words. Each row says what
 * happened; the raw `kind` stays in the row's `title` and in the detail
 * dialog, with the severity and the recorded payload.
 */
function AuthEventsPanel() {
  const q = useAuthAuditEvents();
  const events = q.data?.events ?? [];
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: events.length === 0 });
  const [openId, setOpenId] = useState<string | null>(null);
  const row = (e: (typeof events)[number]) => {
    const words = authEventWords(e);
    return (
      <li key={e.id}>
        <button
          type="button"
          onClick={() => setOpenId(e.id)}
          title={words.code}
          className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand"
        >
          <span className="min-w-0 text-sm text-foreground [overflow-wrap:anywhere]">
            {words.text}
          </span>
          {words.flag && <Pill label={words.flag} color={TONE_COLOR[words.tone]} />}
          <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="max-w-48 truncate" title={e.actor}>
              {actorWords(e.actor)}
            </span>
            <Timestamp value={e.at} />
          </span>
        </button>
      </li>
    );
  };
  return (
    <Panel
      title="Recent activity"
      help="Sign-ins, keys, secrets and account changes, newest first. Open a row for the exact event code and what was recorded."
      padded={phase !== 'ready'}
    >
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage="Reading recent activity…"
          emptyMessage="Nothing has happened on this account yet."
          onRetry={() => void q.refetch()}
        />
      ) : (
        <>
          <ul className="flex flex-col divide-y divide-border">
            {events.slice(0, FIRST_EVENTS).map(row)}
          </ul>
          {events.length > FIRST_EVENTS && (
            <div className="border-t border-border px-5 py-3">
              <Disclosure label={`Show all ${events.length}`}>
                <ul className="-mx-5 flex flex-col divide-y divide-border border-t border-border">
                  {events.slice(FIRST_EVENTS).map(row)}
                </ul>
              </Disclosure>
            </div>
          )}
        </>
      )}
      <AuthEventDetail id={openId} onClose={() => setOpenId(null)} />
    </Panel>
  );
}

/** Every sealed secret across the account — the hygiene inventory, so a
 * stale credential is findable without opening each app. A count first; the
 * rows behind "Show". */
function SecretsInventoryPanel() {
  const q = useAccountSecrets();
  const rows = q.data?.secrets ?? [];
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: rows.length === 0 });
  const apps = new Set(rows.map((r) => r.app_slug)).size;
  return (
    <Panel
      title="Saved secrets"
      help="Sealed secrets: encrypted values your apps read at runtime. This page never shows the values, only where they live and when they last changed."
    >
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage="Reading saved secrets…"
          emptyMessage="No app has a saved secret."
          onRetry={() => void q.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-foreground/85">
            {rows.length === 1 ? '1 secret is' : `${rows.length} secrets are`} saved across{' '}
            {apps === 1 ? '1 app' : `${apps} apps`}. Only those apps can read the values.
          </p>
          <Disclosure label="Show every secret">
            <ul className="well flex flex-col divide-y divide-border rounded-xl bg-muted/40">
              {rows.map((r) => (
                <li
                  key={`${r.app_slug}/${r.key}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-xs"
                >
                  <span className="font-mono">{r.app_slug}</span>
                  <span className="font-mono text-muted-foreground">{r.key}</span>
                  <span className="ml-auto text-muted-foreground">
                    changed <Timestamp value={r.updated_at} />
                  </span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </div>
      )}
    </Panel>
  );
}

export function SecuritySettings() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { openMfa } = useMfa();
  const { data, isPending, error, refetch } = useSessions();
  const events = useAuthAuditEvents();
  const revoke = useRevokeSession();
  const revokeAll = useRevokeAllSessions();
  const [now] = useState(() => Date.now());

  const rows = useMemo<SessionRow[]>(
    () =>
      (data?.sessions ?? []).map((s) => ({
        id: s.id,
        ip: s.issued_ip || '—',
        agent: s.issued_ua ?? '',
        device: deviceWords(s.issued_ua),
        issuedAt: s.issued_at,
        lastSeenAt: s.last_seen_at ?? '',
        current: s.current_session,
      })),
    [data]
  );

  const summary = securitySummary({
    sessions: data?.sessions,
    events: events.data?.events,
    now,
  });

  const signOutEverywhere = async () => {
    if (
      !(await confirm({
        title: 'Sign out everywhere?',
        description: 'Every other browser and CLI session ends. This one stays signed in.',
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
          error: err,
        })
      );
  };

  const columns: Column<SessionRow>[] = [
    {
      key: 'device',
      label: 'Device',
      render: (s) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm" title={s.agent || undefined}>
              {s.device}
            </span>
            {s.current && <Pill label="This browser" color="var(--brand)" />}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{s.ip}</span>
        </span>
      ),
    },
    {
      key: 'lastSeenAt',
      label: 'Last active',
      numeric: true,
      render: (s) => <Timestamp value={s.lastSeenAt} className="text-xs text-muted-foreground" />,
    },
    {
      key: 'issuedAt',
      label: 'Signed in',
      numeric: true,
      priority: 'secondary',
      render: (s) => <Timestamp value={s.issuedAt} className="text-xs text-muted-foreground" />,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <SettingsSummary
        label="Security"
        ariaLabel="Account security"
        tone={summary.tone}
        facts={[
          ...summary.facts,
          'Two-factor sign-in asks for a code from your phone, so a stolen password is not enough',
        ]}
        actions={
          <>
            <Button
              size="sm"
              className="gap-1.5"
              title="Multi-factor authentication (MFA): set up an authenticator, or verify it for this browser"
              onClick={() => openMfa('choose')}
            >
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
              Set up two-factor sign-in
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={revokeAll.isPending}
              onClick={() => void signOutEverywhere()}
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
              Sign out everywhere
            </Button>
          </>
        }
      >
        {summary.sentence}
      </SettingsSummary>

      <Panel
        title="Signed-in devices"
        help="Active sessions from /v1/auth/sessions. Signing a device out ends its session on its next request."
      >
        <ResourceTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'lastSeenAt', dir: 'desc' }}
          searchKeys={['ip', 'agent', 'device']}
          searchPlaceholder="Filter by device or IP…"
          emptyMessage="No other sessions."
          minWidth="min-w-[520px]"
          loading={isPending}
          error={error}
          onRetry={() => void refetch()}
          rowActions={(s) =>
            s.current ? null : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Sign out ${s.device}`}
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: `Sign out ${s.device}?`,
                      description: 'That browser is signed out on its next request.',
                      confirmLabel: 'Sign out device',
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
                        error: err,
                      })
                    );
                }}
              >
                Sign out
              </Button>
            )
          }
        />
      </Panel>

      <AuthEventsPanel />
      <PasswordPanel />
      <SecretsInventoryPanel />
    </div>
  );
}
