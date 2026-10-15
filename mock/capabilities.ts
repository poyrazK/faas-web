import type { components } from '../src/lib/api/schema';
type Capability = components['schemas']['CapabilityStatus'];
type Plan = components['schemas']['CapabilitiesResponse']['plan'];
const ALL: Plan[] = ['free', 'hobby', 'pro', 'scale'];
const PAID: Plan[] = ['hobby', 'pro', 'scale'];
/** Synthetic account availability, not evidence of runtime qualification. */
const entries: Capability[] = [
  {
    key: 'container-deployments',
    name: 'Container deployments',
    category: 'delivery',
    description: 'Deploy a stateless Linux/amd64 OCI image.',
    maturity: 'beta',
    plans: ALL,
    docs_url: '/docs/container-compatibility',
    acceptance: 'mock-only',
    enabled: true,
  },
  {
    key: 'github-deploys',
    name: 'GitHub deployments',
    category: 'delivery',
    description: 'Deploy from a connected repository.',
    maturity: 'beta',
    plans: ALL,
    docs_url: '/docs/deploy-from-github',
    acceptance: 'mock-only',
    enabled: true,
  },
  {
    key: 'object-storage',
    name: 'Private object storage',
    category: 'data',
    description: 'Private buckets and signed URLs.',
    maturity: 'preview',
    plans: PAID,
    docs_url: '/docs/object-storage',
    acceptance: 'mock-only',
    enabled: true,
  },
  {
    key: 'disposable-runs',
    name: 'Disposable isolated runs',
    category: 'runtime',
    description: 'Bounded work in a fresh isolated microVM.',
    maturity: 'preview',
    plans: PAID,
    docs_url: '/docs/executions',
    acceptance: 'mock-only',
    enabled: true,
  },
  {
    key: 'pr-previews',
    name: 'Pull-request previews',
    category: 'delivery',
    description: 'Review an API on its own URL.',
    maturity: 'beta',
    plans: ALL,
    docs_url: '/docs/preview-environments',
    acceptance: 'mock-only',
    enabled: true,
  },
  {
    key: 'workflows-and-jobs',
    name: 'Jobs and workflows',
    category: 'async',
    description: 'Asynchronous jobs and durable workflows.',
    maturity: 'preview',
    plans: PAID,
    docs_url: '/docs/faas_openapi_spec',
    acceptance: 'mock-only',
    enabled: true,
  },
  {
    key: 'durable-inbound-webhooks',
    name: 'Durable inbound webhooks',
    category: 'integration',
    description: 'Verified Stripe ingress with durable app or automation delivery.',
    maturity: 'preview',
    plans: PAID,
    docs_url: '/docs/faas_openapi_spec',
    acceptance: 'mock-only',
    enabled: true,
  },
  {
    key: 'issues',
    name: 'Instrumented Issues',
    category: 'observability',
    description: 'Deployment-bound exception reporting and retained issue triage.',
    maturity: 'preview',
    plans: PAID,
    docs_url: '/docs/faas_openapi_spec',
    acceptance: 'mock-only',
    enabled: true,
  },
  {
    key: 'private-apps',
    name: 'Private apps',
    category: 'networking',
    description: 'Internal-only app visibility and controlled service access.',
    maturity: 'preview',
    plans: ALL,
    docs_url: '/docs/faas_openapi_spec',
    acceptance: 'mock-only',
    enabled: true,
  },
  {
    key: 'internal-services',
    name: 'Internal services',
    category: 'networking',
    description: 'Declared service bindings and caller policy.',
    maturity: 'preview',
    plans: ALL,
    docs_url: '/docs/faas_openapi_spec',
    acceptance: 'mock-only',
    enabled: true,
  },
  {
    key: 'worker-pools',
    name: 'Worker pools',
    category: 'async',
    description: 'Long-lived OCI workers and durable queue consumers.',
    maturity: 'preview',
    plans: PAID,
    docs_url: '/docs/faas_openapi_spec',
    acceptance: 'mock-only',
    enabled: true,
  },
  {
    key: 'declarative-response-caching',
    name: 'Declarative response caching',
    category: 'delivery',
    description: 'Reviewed GET and HEAD edge cache rules with targeted invalidation.',
    maturity: 'preview',
    plans: PAID,
    docs_url: '/docs/faas_openapi_spec',
    acceptance: 'mock-only',
    enabled: true,
  },
];
export function mockCapabilities(
  plan: Plan,
  unavailable: string[]
): components['schemas']['CapabilitiesResponse'] {
  return {
    registry_version: 1,
    plan,
    capabilities: entries.map((entry) => {
      const reason = !entry.plans.includes(plan)
        ? 'plan_not_entitled'
        : unavailable.includes(entry.key)
          ? 'runtime_unavailable'
          : undefined;
      return { ...entry, enabled: !reason, unavailable_reason: reason };
    }),
  };
}
