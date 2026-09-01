import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { SendMail, Trash } from 'iconoir-react';
import { CopyMorph, useCopy } from '@/components/ui/copy-button';
import { OrgKeysPanel, OrgPanel } from '@/components/dashboard/org-panels';
import { FIELD } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { useToast } from '@/components/ui/toast';
import { useConfirm } from '@/components/ui/confirm';
import {
  useChangeMemberRole,
  useInviteMember,
  useOrgInvitations,
  useOrgMembers,
  useOrgs,
  useCreateOrg,
  useDeleteOrg,
  useRemoveMember,
  useRevokeInvitation,
} from '@/lib/api/queries';
import { CreateOrgDialog } from '@/components/dashboard/org-dialogs';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api/errors';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/team')({
  component: TeamPage,
  head: () => consoleHead('team'),
});

/**
 * Members and invitations of an organisation.
 *
 * Entirely read-only before this: no way to invite, change a role, remove
 * someone, or revoke an invitation, against an API that does all four. An
 * invitation's plaintext token is returned exactly once, like a minted API
 * key, so it gets the same reveal-once treatment.
 */

interface MemberRow {
  id: string;
  email: string;
  role: Role;
  joinedAt: string;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}

const ROLES = ['admin', 'developer', 'viewer', 'billing'] as const;
type Role = 'owner' | (typeof ROLES)[number];

const ROLE_COLOR: Record<string, string> = {
  owner: 'var(--brand)',
  admin: 'var(--status-good)',
  billing: 'var(--status-warning)',
};

const ROLE_HINT: Record<(typeof ROLES)[number], string> = {
  admin: 'Everything but transfer ownership.',
  developer: 'Deploy and configure apps. No billing, no members.',
  viewer: 'Read everything, change nothing.',
  billing: 'Invoices and the plan. Nothing else.',
};

function when(value: string | undefined): string {
  if (!value) return '—';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '—' : formatRelative(ms);
}

/** The invitation token, shown once. */
function TokenPanel({
  email,
  token,
  onDismiss,
}: {
  email: string;
  token: string;
  onDismiss: () => void;
}) {
  const { copied, copy } = useCopy();
  return (
    <Panel
      lit
      title="Invitation created"
      description={`Send this token to ${email}. It is shown once — the server keeps only a hash.`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <code className="min-w-0 flex-1 select-all break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-sm">
          {token}
        </code>
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void copy(token)}>
          <CopyMorph copied={copied} />
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </Button>
        <Button size="sm" onClick={onDismiss}>
          I have sent it
        </Button>
      </div>
    </Panel>
  );
}

function TeamPage() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const orgs = useOrgs();
  const [slug, setSlug] = useState('');
  // Both reads below are gated on an org, so a failed org list leaves them
  // permanently pending — which is why the state passed to the tables has to
  // count the org query itself, not just the ones hanging off it.
  const active = slug || orgs.data?.orgs?.[0]?.slug || '';
  const activeOrg = orgs.data?.orgs.find((o) => o.slug === active);
  const createOrg = useCreateOrg();
  const deleteOrg = useDeleteOrg();
  const [createOpen, setCreateOpen] = useState(false);
  const members = useOrgMembers(active);
  const invitations = useOrgInvitations(active);
  const invite = useInviteMember(active);
  const changeRole = useChangeMemberRole(active);
  const removeMember = useRemoveMember(active);
  const revoke = useRevokeInvitation(active);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ROLES)[number]>('developer');
  const [token, setToken] = useState<{ email: string; token: string } | null>(null);

  const memberRows = useMemo<MemberRow[]>(
    () =>
      (members.data?.members ?? []).map((m) => ({
        id: m.account_id,
        email: m.email,
        role: m.role,
        joinedAt: m.joined_at,
      })),
    [members.data]
  );

  const inviteRows = useMemo<InviteRow[]>(
    () =>
      (invitations.data?.invitations ?? []).map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        status: i.status,
        expiresAt: i.expires_at,
      })),
    [invitations.data]
  );

  const memberColumns: Column<MemberRow>[] = [
    {
      key: 'email',
      label: 'Member',
      render: (m) => (
        <span>
          {m.email}
          {m.email === user?.email && (
            <span className="ml-2 text-xs text-muted-foreground">you</span>
          )}
        </span>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      width: 'w-40',
      render: (m) =>
        m.role === 'owner' ? (
          <Pill label="owner" color={ROLE_COLOR.owner} />
        ) : (
          <select
            value={m.role}
            aria-label={`Role for ${m.email}`}
            onChange={async (e) => {
              const next = e.target.value as (typeof ROLES)[number];
              if (
                !(await confirm({
                  title: `Make ${m.email} ${next === 'admin' ? 'an' : 'a'} ${next}?`,
                  description: ROLE_HINT[next],
                  confirmLabel: 'Change role',
                }))
              )
                return;
              void changeRole
                .mutateAsync({ userId: m.id, role: next })
                .then(() => toast({ kind: 'success', title: `${m.email} is now ${next}` }))
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not change role',
                    description: errorMessage(err),
                  })
                );
            }}
            className="h-8 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand/50"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        ),
    },
    {
      key: 'joinedAt',
      label: 'Joined',
      numeric: true,
      render: (m) => <span className="text-xs text-muted-foreground">{when(m.joinedAt)}</span>,
    },
    {
      key: 'id',
      label: '',
      width: 'w-12',
      render: (m) =>
        m.role === 'owner' || m.email === user?.email ? null : (
          <button
            type="button"
            aria-label={`Remove ${m.email}`}
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Remove ${m.email}?`,
                  description:
                    'They lose access to this organisation immediately. Their API keys minted against it stop working.',
                  confirmLabel: 'Remove member',
                  destructive: true,
                }))
              )
                return;
              void removeMember
                .mutateAsync(m.id)
                .then(() => toast({ kind: 'success', title: `Removed ${m.email}` }))
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
          </button>
        ),
    },
  ];

  const inviteColumns: Column<InviteRow>[] = [
    { key: 'email', label: 'Invited' },
    { key: 'role', label: 'Role', width: 'w-28', render: (i) => <Pill label={i.role} /> },
    {
      key: 'status',
      label: 'Status',
      width: 'w-28',
      render: (i) => (
        <Pill
          label={i.status}
          color={
            i.status === 'pending'
              ? 'var(--status-warning)'
              : i.status === 'consumed'
                ? 'var(--status-good)'
                : undefined
          }
        />
      ),
    },
    {
      key: 'expiresAt',
      label: 'Expires',
      numeric: true,
      render: (i) => (
        <span className="text-xs text-muted-foreground">
          {i.status === 'pending' ? when(i.expiresAt).replace(' ago', '') : '—'}
        </span>
      ),
    },
    {
      key: 'id',
      label: '',
      width: 'w-12',
      render: (i) =>
        i.status !== 'pending' ? null : (
          <button
            type="button"
            aria-label={`Revoke invitation for ${i.email}`}
            onClick={async () => {
              if (
                !(await confirm({
                  title: `Revoke the invitation for ${i.email}?`,
                  description: 'The token stops working. Invite them again to send a new one.',
                  confirmLabel: 'Revoke',
                  destructive: true,
                }))
              )
                return;
              void revoke
                .mutateAsync(i.id)
                .then(() => toast({ kind: 'success', title: 'Invitation revoked' }))
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not revoke',
                    description: errorMessage(err),
                  })
                );
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <Trash className="h-3.5 w-3.5" />
          </button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description="Organisation members and their roles. Roles decide who can write what across the console."
        actions={
          <span className="flex items-center gap-2">
            <label className="flex items-center gap-2">
              <span className="label-mono text-muted-foreground">Org</span>
              <select
                value={active}
                onChange={(e) => setSlug(e.target.value)}
                aria-label="Select an organisation"
                className="h-9 rounded-md border border-border bg-card px-2.5 text-sm outline-none focus:border-brand/50"
              >
                {(orgs.data?.orgs ?? []).length === 0 && <option value="">No organisations</option>}
                {(orgs.data?.orgs ?? []).map((o) => (
                  <option key={o.slug} value={o.slug}>
                    {o.slug}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
              New organisation
            </Button>
          </span>
        }
      />

      {token ? (
        <TokenPanel email={token.email} token={token.token} onDismiss={() => setToken(null)} />
      ) : (
        <Panel lit title="Invite a member">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!email.includes('@') || !active || invite.isPending) return;
              void invite
                .mutateAsync({ email: email.trim(), role })
                .then((result) => {
                  setToken({ email: result.email, token: result.token });
                  setEmail('');
                })
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not invite',
                    description: errorMessage(err),
                  })
                );
            }}
          >
            <label className="flex min-w-64 flex-1 flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}
                className={`${FIELD} min-w-36`}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="submit"
              size="sm"
              className="gap-1.5"
              disabled={!email.includes('@') || !active}
              busy={invite.isPending}
            >
              <SendMail className="h-3.5 w-3.5" />
              Invite
            </Button>
            <p className="basis-full text-xs text-muted-foreground">{ROLE_HINT[role]}</p>
          </form>
        </Panel>
      )}

      <Panel title="Members">
        <ResourceTable
          rows={memberRows}
          columns={memberColumns}
          initialSort={{ key: 'email', dir: 'asc' }}
          searchKeys={['email', 'role']}
          searchPlaceholder="Filter by email…"
          emptyMessage={active ? 'No members yet.' : 'No organisations on this account.'}
          minWidth="min-w-[700px]"
          loading={orgs.isPending || (Boolean(active) && members.isPending)}
          error={orgs.error ?? members.error}
          onRetry={() => {
            void orgs.refetch();
            void members.refetch();
          }}
        />
      </Panel>

      <Panel title="Invitations">
        <ResourceTable
          rows={inviteRows}
          columns={inviteColumns}
          emptyMessage="No invitations."
          minWidth="min-w-[640px]"
          loading={orgs.isPending || (Boolean(active) && invitations.isPending)}
          error={orgs.error ?? invitations.error}
          onRetry={() => {
            void orgs.refetch();
            void invitations.refetch();
          }}
        />
      </Panel>
      {active && (
        <>
          <OrgPanel slug={active} />
          <OrgKeysPanel slug={active} />
          {activeOrg && !activeOrg.personal && (
            <Panel
              title="Danger zone"
              description="Deleting an organisation removes every member's access. Apps inside it stop and their data is scheduled for removal."
            >
              <Button
                size="sm"
                variant="destructive"
                busy={deleteOrg.isPending}
                onClick={() =>
                  void confirm({
                    title: `Delete ${activeOrg.name}?`,
                    description:
                      'Members lose access immediately. This cannot be undone from the console.',
                    confirmLabel: 'Delete organisation',
                    destructive: true,
                    typeToConfirm: activeOrg.slug,
                  }).then((ok) => {
                    if (!ok) return;
                    void deleteOrg
                      .mutateAsync(activeOrg.slug)
                      .then(() => {
                        toast({ kind: 'success', title: `Deleted ${activeOrg.slug}` });
                        setSlug('');
                      })
                      .catch((err: unknown) =>
                        toast({
                          kind: 'error',
                          title: 'Could not delete',
                          description: errorMessage(err),
                        })
                      );
                  })
                }
              >
                Delete organisation
              </Button>
            </Panel>
          )}
        </>
      )}

      <CreateOrgDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        busy={createOrg.isPending}
        onCreate={(body) =>
          void createOrg
            .mutateAsync(body)
            .then((created) => {
              setCreateOpen(false);
              setSlug(created.slug);
              toast({ kind: 'success', title: `Created ${created.slug}` });
            })
            .catch((err: unknown) =>
              toast({
                kind: 'error',
                title: 'Could not create organisation',
                description: errorMessage(err),
              })
            )
        }
      />
    </div>
  );
}
