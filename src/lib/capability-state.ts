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
