import type { components } from '@/lib/api/schema';

type SpecEvent = NonNullable<
  components['schemas']['CreateAppWebhookRequest']['event_filter']
>[number];

/** Existing console choices, checked against the API. Preview-only events remain gated out. */
export const WEBHOOK_EVENTS = [
  { event: 'deployment.live', label: 'A deployment goes live', group: 'Deployments' },
  { event: 'deployment.failed', label: 'A deployment fails', group: 'Deployments' },
  { event: 'rollout.completed', label: 'A rollout completes', group: 'Deployments' },
  { event: 'rollout.aborted', label: 'A rollout is aborted', group: 'Deployments' },
  { event: 'app.parked', label: 'The app goes to sleep', group: 'App activity' },
  { event: 'app.woken', label: 'The app wakes up', group: 'App activity' },
  { event: 'app.health.changed', label: 'App health changes', group: 'App activity' },
  { event: 'job.finished', label: 'A job finishes', group: 'App activity' },
  { event: 'operation.finished', label: 'An operation finishes', group: 'App activity' },
  { event: 'workflow.finished', label: 'A workflow finishes', group: 'App activity' },
  { event: 'issue.created', label: 'An issue is created', group: 'Issues and regressions' },
  { event: 'issue.regressed', label: 'An issue returns', group: 'Issues and regressions' },
  { event: 'issue.resolved', label: 'An issue is resolved', group: 'Issues and regressions' },
  {
    event: 'debug.regression.detected',
    label: 'A regression is detected',
    group: 'Issues and regressions',
  },
  {
    event: 'debug.regression.resolved',
    label: 'A regression is resolved',
    group: 'Issues and regressions',
  },
  {
    event: 'routes.health.blocked',
    label: 'Route health blocks a rollout',
    group: 'Issues and regressions',
  },
  { event: 'usage_statement.finalized', label: 'A usage statement is finalized', group: 'Usage' },
] as const satisfies readonly { event: SpecEvent; label: string; group: string }[];

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]['event'];

/** Historical or newer events must remain readable, even when the picker does not offer them. */
export function webhookEventLabel(event: string): string {
  return WEBHOOK_EVENTS.find((item) => item.event === event)?.label ?? event;
}
