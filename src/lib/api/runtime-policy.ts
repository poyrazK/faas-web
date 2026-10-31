import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import { retryPolicy } from './queries';
import type { components } from './schema';

export type RuntimePolicy = components['schemas']['RuntimePolicyStatusResponse'];
export type PolicyComponent =
  | 'request_policy'
  | 'edge_rules'
  | 'cors_presets'
  | 'response_cache'
  | 'egress_allowlist'
  | 'cpu_limit'
  | 'scheduler_scaling';
export type PolicyReceipt = {
  id: string;
  appId: string;
  acceptedAt: number;
  components: PolicyComponent[];
  baseline?: Partial<Record<PolicyComponent, number>>;
  action: 'configuration' | 'purge';
};
export const POLICY_POLL_WINDOW = 120_000;

export function readRuntimePolicy(slug: string, waitSeconds = 0, signal?: AbortSignal) {
  if (!Number.isFinite(waitSeconds) || waitSeconds < 0 || waitSeconds > 10) {
    return Promise.reject(new Error('Policy wait must be between 0 and 10 seconds.'));
  }
  return unwrap(
    api.GET('/v1/apps/{slug}/policy/status', {
      params: { path: { slug }, query: waitSeconds ? { wait: `${waitSeconds}s` } : {} },
      signal,
    })
  );
}

/** Only each component's own fleet/owner evidence can establish convergence. */
export function componentState(
  data: RuntimePolicy,
  key: PolicyComponent
): 'active' | 'pending' | 'unverified' {
  const value = data[key];
  if (!value || !value.desired_revision) return 'unverified';
  if (key === 'scheduler_scaling') {
    const scheduler = data.scheduler_scaling;
    if (scheduler.state === 'unverified') return 'unverified';
    if (
      scheduler.stale ||
      !scheduler.observed_at ||
      !Number.isFinite(Date.parse(scheduler.observed_at)) ||
      scheduler.observed_revision < scheduler.desired_revision
    )
      return 'pending';
    return scheduler.state;
  }
  const fleet =
    'serving_gateways' in value
      ? value.serving_gateways
      : 'serving_nodes' in value
        ? value.serving_nodes
        : 0;
  const applied =
    'applied_gateways' in value
      ? value.applied_gateways
      : 'applied_nodes' in value
        ? value.applied_nodes
        : 0;
  const stale =
    'stale_gateways' in value
      ? value.stale_gateways
      : 'stale_nodes' in value
        ? value.stale_nodes
        : 0;
  const pending =
    'pending_gateways' in value
      ? value.pending_gateways
      : 'pending_nodes' in value
        ? value.pending_nodes
        : 0;
  if (!fleet || value.state === 'unverified') return 'unverified';
  if (stale || pending || applied !== fleet) return 'pending';
  return value.state;
}

/** A read without a pre-write revision cannot prove this particular write applied. */
export function receiptState(data: RuntimePolicy, receipt: PolicyReceipt, key: PolicyComponent) {
  const baseline = receipt.baseline?.[key];
  if (data.app_id !== receipt.appId || baseline === undefined || !data[key]) return 'unverified';
  if (data[key].desired_revision <= baseline) return 'pending';
  return componentState(data, key);
}
export function policyBaseline(
  data: RuntimePolicy | undefined,
  appId: string,
  keys: PolicyComponent[]
) {
  if (!data || data.app_id !== appId) return undefined;
  return Object.fromEntries(
    keys.map((key) => [key, data[key].desired_revision])
  ) as PolicyReceipt['baseline'];
}

const requestFields = new Set([
  'max_concurrency',
  'streaming_enabled',
  'websocket_enabled',
  'route_metrics_enabled',
  'maintenance_mode',
  'require_authn',
  'cors_default_enabled',
  'cors_default_origins',
  'public_auth',
]);
const scalingFields = new Set([
  'idle_timeout_s',
  'min_instances',
  'autoscale_target_rps',
  'autoscale_target_cpu_pct',
  'scaling_policy',
]);
const replacementFields = new Set(['ram_mb', 'vcpu', 'runtime', 'entrypoint', 'env', 'topology']);
export function configurationEffects(fields: string[]) {
  const keys = new Set<PolicyComponent>();
  const replacement: string[] = [];
  const future: string[] = [];
  for (const field of fields) {
    if (field === 'cpu_millicores') keys.add('cpu_limit');
    else if (field === 'egress_allowlist' || field === 'egress_extra_ports')
      keys.add('egress_allowlist');
    else if (requestFields.has(field)) keys.add('request_policy');
    else if (scalingFields.has(field)) keys.add('scheduler_scaling');
    else if (replacementFields.has(field)) replacement.push(field);
    else future.push(field);
  }
  return { components: [...keys].sort(), replacement, future };
}

export function useRuntimePolicy(accountId: string, slug: string, receipt: PolicyReceipt) {
  return useQuery({
    queryKey: ['runtime-policy', accountId, slug, receipt.appId, receipt.id],
    queryFn: async ({ signal }) => {
      const data = await readRuntimePolicy(slug, 0, signal);
      if (data.app_id !== receipt.appId)
        throw new Error('Policy response belongs to a different app.');
      return data;
    },
    enabled: Boolean(accountId && slug && receipt.appId && receipt.components.length),
    retry: retryPolicy,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (query) => {
      if (Date.now() - receipt.acceptedAt >= POLICY_POLL_WINDOW || query.state.error) return false;
      const data = query.state.data;
      return data &&
        receipt.components.every((key) => receiptState(data, receipt, key) === 'active')
        ? false
        : 5_000;
    },
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}
