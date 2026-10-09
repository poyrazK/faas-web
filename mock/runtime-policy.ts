import type { RuntimePolicy, PolicyComponent } from '../src/lib/api/runtime-policy';
const revisions = new Map<string, { revision: number; pending: Set<PolicyComponent> }>();
function entry(id: string) {
  let value = revisions.get(id);
  if (!value) {
    value = { revision: 1, pending: new Set() };
    revisions.set(id, value);
  }
  return value;
}
export function advancePolicy(id: string, components: PolicyComponent[]) {
  const value = entry(id);
  value.revision++;
  for (const component of components) value.pending.add(component);
}
export function mockRuntimePolicy(id: string): RuntimePolicy {
  const value = entry(id);
  const gateway = (key: PolicyComponent) => ({
    scope: 'app' as const,
    desired_revision: value.revision,
    state: value.pending.has(key) ? ('pending' as const) : ('active' as const),
    serving_gateways: 2,
    applied_gateways: value.pending.has(key) ? 0 : 2,
    pending_gateways: value.pending.has(key) ? 2 : 0,
    stale_gateways: 0,
  });
  const nodes = (key: PolicyComponent) => ({
    scope: 'app' as const,
    desired_revision: value.revision,
    state: value.pending.has(key) ? ('pending' as const) : ('active' as const),
    serving_nodes: 1,
    applied_nodes: value.pending.has(key) ? 0 : 1,
    pending_nodes: value.pending.has(key) ? 1 : 0,
    stale_nodes: 0,
  });
  const result: RuntimePolicy = {
    app_id: id,
    desired_revision: value.revision,
    state: 'active',
    coverage: ['gateway'],
    serving_gateways: 2,
    applied_gateways: 2,
    pending_gateways: 0,
    stale_gateways: 0,
    request_policy: gateway('request_policy'),
    edge_rules: gateway('edge_rules'),
    cors_presets: { ...gateway('cors_presets'), scope: 'account' },
    response_cache: gateway('response_cache'),
    cpu_limit: nodes('cpu_limit'),
    egress_allowlist: nodes('egress_allowlist'),
    scheduler_scaling: {
      scope: 'app',
      desired_revision: value.revision,
      observed_revision: value.pending.has('scheduler_scaling')
        ? value.revision - 1
        : value.revision,
      state: value.pending.has('scheduler_scaling') ? 'pending' : 'active',
      stale: false,
      observed_at: new Date().toISOString(),
      scheduler_node_id: 'mock-scheduler',
    },
  };
  value.pending.clear();
  return result;
}
