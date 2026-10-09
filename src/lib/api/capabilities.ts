import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';
import { useAuth } from '../auth';
import { capabilityViewState } from '../capability-state';

export type Capability = components['schemas']['CapabilityStatus'];
export type CapabilityRegistry = components['schemas']['CapabilitiesResponse'];
export const capabilityKey = (accountId: string) => ['account', accountId, 'capabilities'] as const;
export function useCapabilities(accountId: string) {
  return useQuery({
    queryKey: capabilityKey(accountId),
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
  const phase = query.isError
    ? 'error'
    : !id || query.isPending || query.isFetching || registryPlan !== plan
      ? 'loading'
      : 'ready';
  return { query, phase, plan } as const;
}
export function useCapability(key: string) {
  const { query, phase, plan } = useCapabilityRegistry();
  const capability = query.data?.capabilities.find((entry) => entry.key === key);
  return {
    capability,
    state: capabilityViewState(capability, phase, plan),
    refresh: () => void query.refetch(),
  };
}
