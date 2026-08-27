import { useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { LogOut } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import { useRevokeAllSessions, useRevokeSession, useSessions } from '@/lib/api/queries';
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
    </div>
  );
}
