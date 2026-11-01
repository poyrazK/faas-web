import { useCapability, useCapabilityAccess } from './capabilities';
import type { LogDrainKind } from './log-drains';

/**
 * The drain kinds this account may create. `datadog` is its own catalog
 * capability (`datadog-integration`, a child of `log-drains`); apid refuses
 * the kind while it is off (faas capability_gate.go:169), so it is offered
 * only once the registry has said it is on.
 */
export function useLogDrainKinds(): LogDrainKind[] {
  const { access } = useCapabilityAccess('datadog-integration');
  return access === 'on' ? ['http_json', 'otlp', 'datadog'] : ['http_json', 'otlp'];
}

/** "Beta" or "Preview" from the log-drains capability's maturity; "" otherwise. */
export function useLogDrainStage(): string {
  const { capability } = useCapability('log-drains');
  return capability?.maturity === 'beta'
    ? 'Beta'
    : capability?.maturity === 'preview'
      ? 'Preview'
      : '';
}
