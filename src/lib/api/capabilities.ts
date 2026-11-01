import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';
import { useAuth } from '../auth';
import { capabilityAccess, capabilityStage, capabilityViewState } from '../capability-state';
import { useActiveOrg } from '../workspace';

export type Capability = components['schemas']['CapabilityStatus'];
export type CapabilityRegistry = components['schemas']['CapabilitiesResponse'];
export const capabilityKey = (accountId: string) => ['account', accountId, 'capabilities'] as const;
export function useCapabilities(accountId: string) {
  // hidden_capabilities follows the X-Active-Org workspace (faas flagSubject),
  // so each workspace has its own entry under the account's key.
  const org = useActiveOrg();
  return useQuery({
    queryKey: [...capabilityKey(accountId), org ?? 'personal'],
    queryFn: ({ signal }) => unwrap(api.GET('/v1/capabilities', { signal })),
    enabled: Boolean(accountId),
    retry: retryPolicy,
    staleTime: 30_000,
  });
}
export function useCapabilityRegistry() {
  const { account } = useAuth();
  const id = account?.id ?? '';
  const query = useCapabilities(id);
  const cache = useQueryClient();
  const plan = account?.plan;
  const registryPlan = query.data?.plan;
  useEffect(() => {
    if (id && plan && registryPlan && plan !== registryPlan)
      void cache.invalidateQueries({ queryKey: capabilityKey(id) });
  }, [cache, id, plan, registryPlan]);
  // A cached registry for the current plan keeps deciding through a background
  // refetch or a failed one: gated content must not unmount on window focus.
  const current = Boolean(id) && query.data !== undefined && registryPlan === plan;
  const phase = current ? 'ready' : query.isError ? 'error' : 'loading';
  return { query, phase, plan, accountId: id } as const;
}
export function useCapability(key: string) {
  const { query, phase, plan, accountId } = useCapabilityRegistry();
  const capability = query.data?.capabilities.find((entry) => entry.key === key);
  return {
    accountId,
    capability,
    state: capabilityViewState(capability, phase, plan),
    refresh: () => void query.refetch(),
  };
}
/** The account's access to one catalog capability (see `capabilityAccess`). */
export function useCapabilityAccess(id: string) {
  const { query, phase } = useCapabilityRegistry();
  return {
    access: capabilityAccess(query.data, id, phase),
    capability: query.data?.capabilities.find((entry) => entry.key === id),
    refresh: () => void query.refetch(),
  };
}
/** The label a surface carries from its capability's maturity: "Beta", "Preview" or "". */
export function useCapabilityStage(key: string) {
  return capabilityStage(useCapability(key).capability?.maturity);
}
