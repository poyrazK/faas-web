import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Plus, Headset } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/field';
import { useAuth } from '@/lib/auth';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import {
  useSupportTickets,
  useSupportNotifications,
  type SupportScope,
  type SupportFilters,
} from '@/lib/api/support';
import { formatRelative } from '@/lib/mock-data';
import { PageHeader, Panel, EmptyState, LoadingState } from '../primitives';
import { Pill } from '../resource-table';
import {
  SupportGate,
  SupportLink,
  SupportStatus,
  SupportReadState,
  SUPPORT_CATEGORIES,
} from './support-bits';
import { SupportForm } from './support-form';

export function SupportPage({ org, personal = false }: { org?: string; personal?: boolean }) {
  const { account } = useAuth();
  const workspace = useWorkspaceTarget(account?.id);
  if (!workspace.ready || !account) return <LoadingState message="Loading support workspace…" />;
  const scope = { accountId: account.id, org: org ?? (personal ? null : workspace.org) };
  return (
    <SupportGate key={`${scope.accountId}:${scope.org}`} scope={scope}>
      <SupportList scope={scope} />
    </SupportGate>
  );
}

export function SupportList({ scope }: { scope: SupportScope }) {
  const navigate = useNavigate();
  const [create, setCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<SupportFilters>({});
  const tickets = useSupportTickets(scope, filters);
  const rows = tickets.data?.pages.flatMap((page) => page.items) ?? [];
  const canCreate = !tickets.isPending && !tickets.error;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Support"
        meta={
          <>
            <Pill label="Preview" />
            <span className="text-xs text-muted-foreground">{scope.org ?? 'Personal account'}</span>
          </>
        }
        actions={
          <Button disabled={!canCreate} onClick={() => setCreate(true)}>
            <Plus className="size-4" />
            Start a conversation
          </Button>
        }
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <Panel title="Your conversations" padded={false}>
          <form
            className="flex flex-wrap items-center gap-2 px-5 py-4"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters({ ...filters, search: search.trim() || undefined });
            }}
          >
            <Input
              aria-label="Search conversations"
              className="min-w-40 flex-1"
              placeholder="Search conversations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button type="submit" variant="outline">
              Search
            </Button>
            <Select
              aria-label="Conversation status"
              value={filters.status ?? ''}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  status: (e.target.value || undefined) as SupportFilters['status'],
                })
              }
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="pending">Waiting for you</option>
              <option value="resolved">Resolved</option>
            </Select>
          </form>
          {(tickets.isPending || tickets.error) && (
            <div className="px-5 pb-5">
              <SupportReadState query={tickets} />
            </div>
          )}
          {rows.length === 0 && !tickets.isPending && !tickets.error && (
            <div className="px-5 pb-5">
              <EmptyState
                message={
                  filters.search || filters.status
                    ? 'No conversations match these filters.'
                    : 'Need a hand? Start a conversation with our team.'
                }
                action={
                  !filters.search && !filters.status ? (
                    <Button variant="outline" onClick={() => setCreate(true)}>
                      Start a conversation
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
          <ul className="divide-y divide-border">
            {rows.map((ticket) => (
              <li key={ticket.id}>
                <SupportLink
                  org={scope.org}
                  ticket={ticket.id}
                  className="group flex min-w-0 flex-wrap items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <span className="truncate">{ticket.subject}</span>
                      {Boolean(ticket.unread_count) && (
                        <span className="shrink-0 rounded-full bg-brand/10 px-2 py-0.5 text-xs text-brand">
                          {ticket.unread_count} unread
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {SUPPORT_CATEGORIES.find(([key]) => key === ticket.category)?.[1] ??
                        ticket.category}{' '}
                      · Updated {formatRelative(Date.parse(ticket.updated_at))}
                    </p>
                  </div>
                  <SupportStatus status={ticket.status} />
                </SupportLink>
              </li>
            ))}
          </ul>
          {tickets.hasNextPage && (
            <div className="p-5">
              <Button
                variant="outline"
                disabled={tickets.isFetchingNextPage}
                onClick={() => void tickets.fetchNextPage()}
              >
                Load more conversations
              </Button>
            </div>
          )}
        </Panel>
        <SupportUpdates
          scope={scope}
          subjects={new Map(rows.map((ticket) => [ticket.id, ticket.subject]))}
        />
      </div>
      {create && (
        <SupportForm
          scope={scope}
          onClose={() => setCreate(false)}
          onCreated={(ticket) => {
            setCreate(false);
            void (scope.org
              ? navigate({
                  to: '/dashboard/orgs/$org/support/$ticket',
                  params: { org: scope.org, ticket },
                })
              : navigate({ to: '/dashboard/support/$ticket', params: { ticket } }));
          }}
        />
      )}
    </div>
  );
}

export function SupportUpdates({
  scope,
  subjects,
}: {
  scope: SupportScope;
  subjects?: Map<string, string>;
}) {
  const [unread, setUnread] = useState(false);
  const updates = useSupportNotifications(scope, unread);
  const rows = updates.data?.pages.flatMap((page) => page.items) ?? [];
  const count = updates.data?.pages[0]?.unread_count;
  return (
    <Panel
      title="Updates"
      help="Read state is yours. Opening the complete conversation marks the updates you have seen as read. Updates are kept for 90 days."
      actions={
        count !== undefined ? (
          <span className="text-xs text-muted-foreground">{count} unread</span>
        ) : undefined
      }
    >
      <label className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} />
        Unread only
      </label>
      <SupportReadState query={updates} />
      {!updates.error && !updates.isPending && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {unread ? 'You’re all caught up.' : 'Replies from our team will appear here.'}
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((item) => (
          <li key={item.id}>
            <SupportLink
              org={scope.org}
              ticket={item.ticket_id}
              className="flex items-start gap-3 rounded-md py-2 text-sm hover:text-brand"
            >
              <Headset className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block">
                  {item.kind === 'staff_reply' ? 'Support replied' : 'Conversation updated'}
                  {!item.read_at && <span className="ml-2 text-xs text-brand">Unread</span>}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatRelative(Date.parse(item.created_at))}
                </span>
                <span
                  className="block truncate text-xs text-muted-foreground"
                  title={item.ticket_id}
                >
                  {subjects?.get(item.ticket_id) ?? `Conversation ${item.ticket_id.slice(0, 8)}`}
                </span>
              </span>
            </SupportLink>
          </li>
        ))}
      </ul>
      {updates.hasNextPage && (
        <Button
          className="mt-4"
          variant="outline"
          size="sm"
          disabled={updates.isFetchingNextPage}
          onClick={() => void updates.fetchNextPage()}
        >
          Older updates
        </Button>
      )}
    </Panel>
  );
}
