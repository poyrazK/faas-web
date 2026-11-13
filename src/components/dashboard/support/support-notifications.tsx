import { Headset } from 'iconoir-react';
import { useAuth } from '@/lib/auth';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useCapabilityRegistry } from '@/lib/api/capabilities';
import { useSupportNotifications, type SupportScope } from '@/lib/api/support';
import { SupportLink } from './support-bits';

export function SupportNotificationsButton() {
  const { account } = useAuth();
  const workspace = useWorkspaceTarget(account?.id);
  const { query, phase } = useCapabilityRegistry();
  // Background polling requires an explicitly advertised preview. An older
  // installation without Support should not receive a new request every 30s.
  const support = query.data?.capabilities?.find((entry) => entry.key === 'customer-support');
  if (
    !workspace.ready ||
    !account ||
    phase !== 'ready' ||
    !support?.enabled ||
    query.data?.hidden_capabilities?.includes('customer-support')
  )
    return null;
  return (
    <SupportUnread
      key={`${account.id}:${workspace.org}`}
      scope={{ accountId: account.id, org: workspace.org }}
    />
  );
}

function SupportUnread({ scope }: { scope: SupportScope }) {
  const query = useSupportNotifications(scope, true);
  const count = query.data?.pages[0]?.unread_count;
  return (
    <SupportLink
      org={scope.org}
      className="pressable inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <Headset className="size-4" aria-hidden="true" />
      <span className="sr-only sm:not-sr-only">Support</span>
      {query.error ? (
        <span title="Support updates unavailable" aria-label="Support updates unavailable">
          !
        </span>
      ) : count !== undefined && count > 0 ? (
        <span
          className="rounded-full bg-brand/10 px-1.5 text-brand"
          aria-label={`${count} unread support updates`}
        >
          {count}
        </span>
      ) : null}
    </SupportLink>
  );
}
