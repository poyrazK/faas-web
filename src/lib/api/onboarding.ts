import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { useApps } from './queries';
import type { OnboardingOwner } from '../onboarding-draft';

/** Account keys keep newly restored setup independent of another actor's cache. */
export function useOnboardingInventory(owner: OnboardingOwner) {
  const apps = useApps({ enabled: Boolean(owner.account), retry: false }, owner.account);
  const company = useQuery({
    queryKey: ['onboarding', owner.account, owner.workspace, 'apps'],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/orgs/{slug}/apps', { params: { path: { slug: owner.workspace! } }, signal })
      ),
    enabled: Boolean(owner.account && owner.workspace),
    retry: false,
  });
  const latest = useQuery({
    queryKey: ['onboarding', owner.account, owner.workspace, 'latest'],
    queryFn: ({ signal }) => unwrap(api.GET('/v1/deployments/latest-by-app', { signal })),
    enabled: Boolean(owner.account),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.items.some((d) =>
        ['pending', 'building', 'imaging', 'snapshotting'].includes(d.status)
      )
        ? 2500
        : false,
  });
  const companyIds = new Set(company.data?.apps.map((app) => app.id) ?? []);
  const scoped = owner.workspace
    ? (apps.data ?? []).filter((app) => companyIds.has(app.id))
    : (apps.data ?? []);
  return {
    apps: scoped,
    deployments: latest.data?.items ?? [],
    pending: apps.isPending || latest.isPending || Boolean(owner.workspace && company.isPending),
    error: apps.error ?? latest.error ?? (owner.workspace ? company.error : null),
    refresh: () => {
      void apps.refetch();
      void latest.refetch();
      if (owner.workspace) void company.refetch();
    },
  };
}
