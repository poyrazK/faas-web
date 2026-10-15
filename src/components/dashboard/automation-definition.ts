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

/** `dependencies` keeps names verbatim, including ones that match no step in this definition. */
export type StepDraft = { spec: AutomationStep; input: string; dependencies: string[] };
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
      dependencies: [...(step.depends_on ?? [])],
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
        depends_on: step.dependencies.filter((name) => name.trim()),
      };
    }),
  };
}

/**
 * Renaming a step keeps the steps that ran after it pointing at it. Only a
 * name that identified exactly one step is followed, so an ambiguous rename
 * never rewrites another step's dependencies.
 */
export function renameStep(steps: StepDraft[], index: number, name: string): StepDraft[] {
  const previous = steps[index].spec.name;
  const unique = previous && steps.filter((step) => step.spec.name === previous).length === 1;
  return steps.map((step, i) =>
    i === index
      ? { ...step, spec: { ...step.spec, name } }
      : unique && step.dependencies.includes(previous)
        ? {
            ...step,
            dependencies: step.dependencies.map((dependency) =>
              dependency === previous ? name : dependency
            ),
          }
        : step
  );
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

export type AutomationTemplate = 'handler' | 'scheduled' | 'sequence';

export const AUTOMATION_TEMPLATES: {
  id: AutomationTemplate;
  title: string;
  description: string;
}[] = [
  { id: 'handler', title: 'Call a handler', description: 'Start manually with one app endpoint.' },
  {
    id: 'scheduled',
    title: 'Run on a schedule',
    description: 'Call an endpoint every hour in UTC.',
  },
  {
    id: 'sequence',
    title: 'Connect two steps',
    description: 'Run a second handler after the first succeeds.',
  },
];

export function newDefinition(template: AutomationTemplate = 'handler'): Definition {
  return {
    name: '',
    trigger:
      template === 'scheduled'
        ? { type: 'schedule', schedule: '0 * * * *', timezone: 'UTC', overlap: 'skip' }
        : { type: 'manual' },
    max_concurrent_runs: 0,
    max_concurrent_actions: 0,
    steps:
      template === 'sequence'
        ? [
            { name: 'step-1', path: '/', method: 'POST' },
            { name: 'step-2', path: '/', method: 'POST', depends_on: ['step-1'] },
          ]
        : [{ name: 'step-1', path: '/', method: template === 'scheduled' ? 'GET' : 'POST' }],
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

export type ObservedRoute = { path: string; methods: string[] };

/**
 * Handler-path suggestions from `/v1/apps/{slug}/routes`, whose items are
 * `"<METHOD> <PATH>"` plus the reserved `__route_other__` overflow bucket.
 * Anything that does not parse is skipped rather than guessed at.
 */
export function observedRoutes(routes: readonly string[] | undefined): ObservedRoute[] {
  const byPath = new Map<string, Set<string>>();
  for (const route of routes ?? []) {
    const match = /^([A-Z]+)\s+(\/\S*)$/.exec(route.trim());
    if (!match) continue;
    const [, method, path] = match;
    byPath.set(path, (byPath.get(path) ?? new Set()).add(method));
  }
  return [...byPath]
    .map(([path, methods]) => ({ path, methods: [...methods].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
