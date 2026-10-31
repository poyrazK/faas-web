import { useEffect } from 'react';
import { Link } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, NavArrowDown, Plus, Settings } from 'iconoir-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useOrgs } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { bindWorkspaceAccount, setActiveOrg, useActiveOrg } from '@/lib/workspace';
import { cn } from '@/lib/utils';

/**
 * The breadcrumb root: which organization the console is working in.
 *
 * It replaced a free-text "workspace" label kept in this browser (it read
 * `acme-corp` until someone typed over it), which named nothing the API knew.
 * These are the account's real organizations from `GET /v1/orgs`; choosing one
 * sends `X-Active-Org` on every request, and new apps are created through
 * `POST /v1/orgs/{slug}/apps` so they are attributed to it. A stored choice the
 * account no longer belongs to is dropped as soon as the list says so.
 */
export function WorkspaceSwitcher() {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const orgs = useOrgs();
  const active = useActiveOrg();
  const qc = useQueryClient();

  useEffect(() => bindWorkspaceAccount(accountId), [accountId]);

  const available = (orgs.data?.orgs ?? []).filter((org) => org.status !== 'deleted_pending');
  const personal = available.find((org) => org.personal);
  const current = (active && available.find((org) => org.slug === active)) || personal;

  useEffect(() => {
    if (active && orgs.data && !available.some((org) => org.slug === active)) setActiveOrg(null);
  }, [active, orgs.data, available]);

  const choose = (slug: string | null) => {
    if (slug === active) return;
    setActiveOrg(slug);
    // Every cached read was answered for the previous organization.
    void qc.invalidateQueries();
  };

  const label = current ? (current.personal ? 'Personal' : current.name || current.slug) : '…';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Workspace: ${label}. Switch workspace`}
        className="pressable flex shrink-0 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted focus-visible:outline-2 focus-visible:outline-brand"
      >
        <span className="flex h-5 w-5 items-center justify-center rounded bg-brand/20 text-[9px] font-semibold uppercase text-brand">
          {label.charAt(0)}
        </span>
        <span className="hidden text-muted-foreground sm:inline">{label}</span>
        <NavArrowDown aria-hidden className="h-3 w-3 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="label-mono text-muted-foreground">
          Workspaces
        </DropdownMenuLabel>
        {orgs.isPending ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">Loading organizations…</p>
        ) : orgs.isError ? (
          <p className="px-2.5 py-2 text-sm text-muted-foreground">
            Organizations could not be loaded.
          </p>
        ) : (
          available.map((org) => {
            const selected = org.slug === current?.slug;
            return (
              <DropdownMenuItem
                key={org.slug}
                onSelect={() => choose(org.personal ? null : org.slug)}
                className="justify-between"
              >
                <span className="min-w-0 truncate">
                  {org.personal ? 'Personal' : org.name || org.slug}
                  <span className="ml-2 text-xs text-muted-foreground">{org.plan}</span>
                </span>
                <Check aria-hidden className={cn('h-3.5 w-3.5', !selected && 'invisible')} />
                {selected && <span className="sr-only">(current)</span>}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/dashboard/settings" search={{ section: 'organization' }}>
            <Plus aria-hidden className="h-3.5 w-3.5" />
            Create an organization
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/dashboard/settings" search={{ section: 'members' }}>
            <Settings aria-hidden className="h-3.5 w-3.5" />
            Members and invitations
          </Link>
        </DropdownMenuItem>
        <p className="px-2.5 pb-2 pt-1 text-xs leading-relaxed text-muted-foreground">
          Organization settings, members, keys, the workspace's app inventory on Projects, and new
          apps follow the selected workspace. The full app list and projects stay your signed-in
          account's.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
