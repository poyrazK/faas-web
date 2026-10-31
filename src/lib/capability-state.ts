import type { Capability, CapabilityRegistry } from './api/capabilities';

export type CapabilityViewState =
  | 'loading'
  | 'registry-error'
  | 'unknown'
  | 'available'
  | 'plan-not-entitled'
  | 'runtime-unavailable';
export function capabilityViewState(
  capability: Capability | undefined,
  phase: 'loading' | 'error' | 'ready',
  plan: CapabilityRegistry['plan'] | undefined
): CapabilityViewState {
  if (phase === 'error') return 'registry-error';
  if (phase === 'loading') return 'loading';
  if (!capability || capability.maturity === 'internal') return 'unknown';
  if (capability.enabled) return 'available';
  if (capability.unavailable_reason === 'runtime_unavailable') return 'runtime-unavailable';
  if (capability.unavailable_reason === 'plan_not_entitled') return 'plan-not-entitled';
  return plan && !capability.plans.includes(plan) ? 'plan-not-entitled' : 'unknown';
}
export const CAPABILITY_LABELS: Record<CapabilityViewState, string> = {
  loading: 'Checking availability…',
  'registry-error': 'Availability could not be checked',
  unknown: 'Availability not confirmed',
  available: 'Available',
  'plan-not-entitled': 'Not included in your plan',
  'runtime-unavailable': 'Unavailable on this installation',
};

export type CapabilityAccess =
  'loading' | 'on' | 'off' | 'plan-not-entitled' | 'runtime-unavailable' | 'registry-error';

/**
 * Whether a catalog capability is usable by this account, read the way apid
 * decides it: `hidden_capabilities` names every capability whose flag is off,
 * internal ones included (faas handlers_capabilities.go); internal ones are
 * never listed in `capabilities` (pkg/api/capabilities.go), so an id absent
 * from both is released to this account. A server without the gate omits
 * `hidden_capabilities`, which hides nothing.
 */
export function capabilityAccess(
  registry: CapabilityRegistry | undefined,
  id: string,
  phase: 'loading' | 'error' | 'ready'
): CapabilityAccess {
  if (phase === 'error') return 'registry-error';
  if (phase === 'loading' || !registry) return 'loading';
  if (registry.hidden_capabilities?.includes(id)) return 'off';
  const entry = registry.capabilities.find((c) => c.key === id);
  if (!entry || entry.enabled) return 'on';
  return entry.unavailable_reason === 'runtime_unavailable'
    ? 'runtime-unavailable'
    : 'plan-not-entitled';
}

/**
 * "Beta" or "Preview" from a capability's maturity, for the label a surface
 * carries while its capability is not GA; "" for GA, internal or unknown.
 */
export function capabilityStage(maturity: string | undefined): '' | 'Beta' | 'Preview' {
  return maturity === 'beta' ? 'Beta' : maturity === 'preview' ? 'Preview' : '';
}
