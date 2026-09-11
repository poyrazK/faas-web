import { createFileRoute, Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { PageHeader } from '@/components/dashboard/primitives';
import { SettingsPanels } from '@/components/dashboard/settings-panels';
import { IntegrationSettings } from '@/components/dashboard/integration-settings';
import { SecuritySettings } from '@/components/dashboard/security-settings';
import { PersonalKeysBody } from '@/components/dashboard/personal-keys';
import { OrgKeysPanel, OrgPanel } from '@/components/dashboard/org-panels';
import { TeamMembersBody } from '@/components/dashboard/team-members';
import {
  CreateOrganization,
  DeleteOrganization,
} from '@/components/dashboard/organization-settings';
import {
  validateSettingsSearch,
  type SettingsSearch,
} from '@/components/dashboard/settings-search';
import { useOrgMembers, useOrgs } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/settings')({
  validateSearch: validateSettingsSearch,
  head: () => consoleHead('settings'),
  component: SettingsPage,
});

function OrganizationScope({
  search,
  onSelection,
}: {
  search: SettingsSearch;
  onSelection: (patch: Partial<SettingsSearch>) => void;
}) {
  const orgs = useOrgs();
  const { user } = useAuth();
  const available = (orgs.data?.orgs ?? [])
    .filter((org) => org.status !== 'deleted_pending')
    .sort((a, b) => a.slug.localeCompare(b.slug));
  const active = available.find((org) => org.slug === search.org) ?? available[0];
  const members = useOrgMembers(active?.slug ?? '');
  const role = members.error
    ? undefined
    : members.data?.members.find((member) => member.email === user?.email)?.role;
  const organization = search.section === 'organization';
  return (
    <div className="flex flex-col gap-6">
      <label className="flex max-w-sm flex-col gap-1.5">
        Active organization
        <select
          className="h-9 rounded-md border border-border bg-card px-2.5 text-sm"
          value={active?.slug ?? ''}
          onChange={(event) => onSelection({ org: event.target.value })}
        >
          {!available.length && <option value="">No organizations</option>}
          {available.map((org) => (
            <option key={org.slug} value={org.slug}>
              {org.slug}
            </option>
          ))}
        </select>
      </label>
      {organization && <CreateOrganization onCreated={(org) => onSelection({ org })} />}
      {orgs.isPending ? (
        <p role="status">Loading organizations…</p>
      ) : orgs.error ? (
        <div>
          <p role="alert">{errorMessage(orgs.error)}</p>
          <Button onClick={() => void orgs.refetch()}>Retry organizations</Button>
        </div>
      ) : !active ? (
        <p>No organizations on this account.</p>
      ) : (
        <>
          {organization ? (
            <>
              <OrgPanel key={active.slug} slug={active.slug} />
              {!active.personal && role === 'owner' && (
                <DeleteOrganization
                  key={`delete-${active.slug}`}
                  slug={active.slug}
                  onDeleted={() =>
                    onSelection({ org: available.find((org) => org.slug !== active.slug)?.slug })
                  }
                />
              )}
            </>
          ) : search.section === 'members' ? (
            <TeamMembersBody key={active.slug} active={active.slug} orgs={orgs} />
          ) : (
            <>
              {members.error && (
                <div>
                  <p role="alert">{errorMessage(members.error)}</p>
                  <Button onClick={() => void members.refetch()}>Retry permissions</Button>
                </div>
              )}
              {members.isPending ? (
                <p role="status">Loading key permissions…</p>
              ) : (
                <OrgKeysPanel
                  key={`${active.slug}-${role ?? 'unknown'}`}
                  slug={active.slug}
                  canManage={!members.error && (role === 'owner' || role === 'admin')}
                />
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function SettingsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/dashboard/settings' });
  const hash = useRouterState({ select: (state) => state.location.hash });
  const section = search.section ?? 'general';
  const scope = search.scope ?? 'personal';
  const onSelection = (patch: Partial<SettingsSearch>) => {
    void navigate({ search: (previous) => ({ ...previous, ...patch }), hash });
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Account preferences, organization access and security."
      />
      <SettingsPanels section={section} />
      {(section === 'organization' || section === 'members') && (
        <OrganizationScope search={{ ...search, section }} onSelection={onSelection} />
      )}
      {section === 'integrations' && <IntegrationSettings search={search} />}
      {section === 'security' && <SecuritySettings />}
      {section === 'api-keys' && (
        <>
          <nav aria-label="API key scopes" className="flex gap-3">
            {(['personal', 'organization'] as const).map((value) => (
              <Link
                key={value}
                to="/dashboard/settings"
                search={(previous) => ({ ...previous, section: 'api-keys', scope: value })}
                hash={hash}
                aria-current={scope === value ? 'page' : undefined}
                className="rounded-md border border-border px-3 py-2 text-sm aria-[current=page]:border-brand"
              >
                {value === 'personal' ? 'Personal' : 'Organization'}
              </Link>
            ))}
          </nav>
          {scope === 'personal' ? (
            <PersonalKeysBody />
          ) : (
            <OrganizationScope search={search} onSelection={onSelection} />
          )}
        </>
      )}
    </div>
  );
}
