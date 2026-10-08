import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
export const definitions = new Map<string, S['AutomationResponse'][]>();
export const runs = new Map<string, S['WorkflowRunResponse'][]>();
export const revisions = new Map<string, S['AutomationRevisionResponse'][]>();
export const steps = new Map<string, S['WorkflowStepResponse'][]>();
const publishedAt = new Date(db.NOW - 3_600_000).toISOString();
const finishedAt = new Date(db.NOW - 3_540_000).toISOString();

for (const app of db.apps) {
  const definition: S['WorkflowSpec'] = {
    name: 'process-request',
    max_concurrent_runs: 4,
    max_concurrent_actions: 8,
    trigger: { type: 'event', source: 'orders', event_type: 'order.created' },
    steps: [
      {
        name: 'validate',
        path: '/validate',
        method: 'POST',
        input: { order: '{{input.data.order_id}}' },
      },
      {
        name: 'process',
        path: '/process',
        method: 'POST',
        depends_on: ['validate'],
        retry: { max_attempts: 4, backoff: 'exponential' },
      },
    ],
  };
  const draft: S['WorkflowSpec'] = {
    name: 'daily-summary',
    max_concurrent_runs: 0,
    max_concurrent_actions: 0,
    trigger: { type: 'schedule', schedule: '0 9 * * *', timezone: 'UTC' },
    steps: [{ name: 'summarize', path: '/summary', method: 'POST' }],
  };
  definitions.set(
    app.slug,
    db.EMPTY
      ? []
      : [
          {
            name: definition.name,
            version: 3,
            source: 'dashboard',
            draft: definition,
            published: definition,
            published_version: 2,
            enabled: true,
            updated_at: publishedAt,
          },
          {
            name: draft.name,
            version: 1,
            source: 'draft',
            draft,
            enabled: false,
            updated_at: publishedAt,
          },
        ]
  );
  revisions.set(`${app.slug}/${definition.name}`, [
    {
      version: 2,
      definition,
      definition_hash: 'a'.repeat(64),
      recorded_at: publishedAt,
      legacy_snapshot: false,
      published_by_account_id: db.account.id,
    },
  ]);
  const run: S['WorkflowRunResponse'] = {
    id: randomUUID(),
    app_id: app.id,
    workflow_name: definition.name,
    status: 'succeeded',
    created_at: publishedAt,
    updated_at: finishedAt,
    scheduled_for: publishedAt,
    started_at: publishedAt,
    finished_at: finishedAt,
    input: { data: { order_id: 'ord_example' } },
    output: { processed: true },
  };
  runs.set(app.slug, db.EMPTY ? [] : [run]);
  steps.set(
    run.id,
    definition.steps.map((step) => ({
      step_name: step.name,
      status: 'succeeded',
      attempt: 1,
      created_at: publishedAt,
      started_at: publishedAt,
      finished_at: finishedAt,
      input: {},
      output: { ok: true },
    }))
  );
}

export function validate(definition: S['WorkflowSpec']): S['ValidateAutomationResponse'] {
  const issues: string[] = [];
  if (!definition?.name) issues.push('Automation name is required.');
  if (!definition?.steps?.length) issues.push('At least one step is required.');
  const names = new Set<string>();
  for (const step of definition?.steps ?? []) {
    if (names.has(step.name)) issues.push(`Duplicate step name: ${step.name}`);
    names.add(step.name);
  }
  for (const step of definition?.steps ?? [])
    for (const dep of step.depends_on ?? []) {
      if (!names.has(dep)) issues.push(`Unknown dependency: ${dep}`);
    }
  return {
    valid: issues.length === 0,
    issues,
    step_order: definition?.steps?.map((step) => step.name) ?? [],
  };
}

export function simulate(body: S['SimulateAutomationRequest']): S['SimulateAutomationResponse'] {
  const validation = validate(body.definition);
  const trace: S['AutomationSimulationStep'][] = validation.valid
    ? body.definition.steps.map((step) => {
        const supplied = Object.hasOwn(body.mock_outputs ?? {}, step.name);
        return {
          step_name: step.name,
          kind: step.path ? 'path' : 'duration_wait',
          state: supplied ? 'mocked' : step.path ? 'would_execute' : 'would_wait',
          input: step.input,
          output: body.mock_outputs?.[step.name],
        };
      })
    : [];
  return {
    definition_valid: validation.valid,
    definition_hash: 'b'.repeat(64),
    complete: trace.length > 0 && trace.every((step) => step.state === 'mocked'),
    issues: validation.issues,
    warnings: ['Dev mock trace. The deployed API evaluates dependencies and input templates.'],
    step_order: validation.step_order,
    trace,
  };
}

export function health(slug: string, name: string): S['AutomationHealthResponse'] {
  const list = (runs.get(slug) ?? []).filter((run) => run.workflow_name === name);
  const succeeded = list.filter((run) => run.status === 'succeeded').length;
  const last = list[0];
  return {
    app_slug: slug,
    automation_name: name,
    window_start: new Date(db.NOW - 7 * 86_400_000).toISOString(),
    window_end: new Date(db.NOW).toISOString(),
    run_count: list.length,
    completed_run_count: succeeded,
    active_run_count: 0,
    queued_run_count: 0,
    success_rate: succeeded ? 1 : 0,
    status_counts: { pending: 0, running: 0, awaiting_event: 0, succeeded, failed: 0, dead: 0 },
    failed_steps: [],
    last_run: last && {
      id: last.id,
      status: last.status,
      created_at: last.created_at,
      finished_at: last.finished_at ?? undefined,
    },
    last_success: last && {
      id: last.id,
      status: last.status,
      created_at: last.created_at,
      finished_at: last.finished_at ?? undefined,
    },
  };
}
