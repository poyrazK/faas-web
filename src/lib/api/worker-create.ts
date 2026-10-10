import { api, unwrap } from './client';
import type { components } from './schema';

type Plan = components['schemas']['CapabilitiesResponse']['plan'];

/** A fresh authority fence for each worker app or image write. */
export async function readWorkerCreateContext(accountId: string, plan: Plan, signal?: AbortSignal) {
  const [account, registry] = await Promise.all([
    unwrap(api.GET('/v1/account', { signal })),
    unwrap(api.GET('/v1/capabilities', { signal })),
  ]);
  const required = ['worker-pools', 'container-deployments', 'private-apps'];
  if (
    account.id !== accountId ||
    account.plan !== plan ||
    registry.plan !== plan ||
    plan === 'free' ||
    required.some((key) => {
      const capability = registry.capabilities.find((item) => item.key === key);
      return !capability?.enabled || !capability.plans.includes(plan);
    })
  )
    throw new Error('Worker image capability is no longer available for this account.');
}
