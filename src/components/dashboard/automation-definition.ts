import type { AutomationStep, Definition } from '@/lib/api/automations';

export const jsonText = (value: unknown) => JSON.stringify(value ?? null, null, 2);

export function jsonValue(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

export function jsonObject(text: string, label: string): Record<string, unknown> {
  const value = jsonValue(text, label);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

export type StepDraft = { spec: AutomationStep; input: string; dependencies: string };
export type DefinitionDraft = {
  spec: Definition;
  steps: StepDraft[];
  scheduledInput: string;
  eventFilter: string;
};

export function definitionDraft(spec: Definition): DefinitionDraft {
  return {
    spec,
    steps: spec.steps.map((step) => ({
      spec: step,
      input: step.input === undefined ? '' : jsonText(step.input),
      dependencies: (step.depends_on ?? []).join(', '),
    })),
    scheduledInput: jsonText(spec.trigger?.input),
    eventFilter: jsonText(spec.trigger?.filter ?? {}),
  };
}

export function candidateDefinition(draft: DefinitionDraft): Definition {
  const trigger = draft.spec.trigger;
  return {
    ...draft.spec,
    trigger:
      trigger?.type === 'schedule'
        ? { ...trigger, input: jsonValue(draft.scheduledInput, 'Scheduled input') }
        : trigger?.type === 'event'
          ? { ...trigger, filter: jsonObject(draft.eventFilter, 'Event filter') }
          : trigger,
    steps: draft.steps.map((step, index) => {
      const spec = { ...step.spec };
      if (step.input.trim())
        spec.input = jsonValue(step.input, `Step ${index + 1} input`) as AutomationStep['input'];
      else delete spec.input;
      return {
        ...spec,
        depends_on: step.dependencies
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean),
      };
    }),
  };
}

export function parseDefinition(text: string): Definition {
  const value = jsonObject(text, 'Definition');
  if (
    typeof value.name !== 'string' ||
    !Array.isArray(value.steps) ||
    value.steps.some((s) => !s || typeof s !== 'object' || typeof s.name !== 'string')
  )
    throw new Error('A definition needs a name and an array of named steps.');
  return value as Definition;
}

export type StepKind = 'path' | 'duration' | 'event' | 'callback' | 'advanced';
export function stepKind(step: AutomationStep): StepKind {
  if (step.path !== undefined) return 'path';
  if (step.wait_for_duration !== undefined) return 'duration';
  if (step.wait_for_event !== undefined) return 'event';
  if (step.wait_for_callback) return 'callback';
  return 'advanced';
}

export function changeStepKind(step: AutomationStep, kind: StepKind): AutomationStep {
  const next = { ...step };
  for (const key of [
    'path',
    'method',
    'run',
    'outbound',
    'for_each',
    'join',
    'wait_for_duration',
    'wait_for_event',
    'wait_for_callback',
    'wait_for_condition',
    'managed_operation',
  ] as const)
    delete next[key];
  if (kind !== 'path') {
    delete next.input;
    delete next.retry;
    delete next.on_failure;
  }
  if (kind === 'duration') {
    delete next.timeout;
    delete next.on_timeout;
  }
  if (kind === 'path') return { ...next, path: '/', method: 'POST' };
  if (kind === 'duration') return { ...next, wait_for_duration: '1m' };
  if (kind === 'event')
    return { ...next, wait_for_event: 'event-name', timeout: next.timeout ?? '1h' };
  if (kind === 'callback')
    return { ...next, wait_for_callback: true, timeout: next.timeout ?? '1h' };
  return step;
}

export function newDefinition(): Definition {
  return {
    name: '',
    trigger: { type: 'manual' },
    max_concurrent_runs: 0,
    max_concurrent_actions: 0,
    steps: [{ name: 'step-1', path: '/', method: 'POST' }],
  };
}

export function availabilityMessage(runtimeEnabled: boolean, reason?: string): string | undefined {
  const reasons: Record<string, string> = {
    runtime_disabled: 'Automation execution is not enabled on this platform.',
    plan_not_allowed: 'Your plan does not include automation execution.',
    account_inactive: 'Your account must be active before automations can run.',
    maintenance: 'This app is in maintenance mode.',
    tenant_required: 'This app requires tenant-scoped starts. Run it through the tenant API.',
    deployment_unavailable: 'Deploy this app before running automations.',
  };
  if (reason) return reasons[reason] ?? `Execution is unavailable: ${reason}.`;
  return runtimeEnabled ? undefined : reasons.runtime_disabled;
}
