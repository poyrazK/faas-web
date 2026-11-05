import type { components } from './api/schema';
import type { ImageCreateRequest } from './image-operation';

type Plan = components['schemas']['CapabilitiesResponse']['plan'];
type RestartPolicy = NonNullable<ImageCreateRequest['restart_policy']>;

export function workerLifecycleErrors(plan: Plan, startupDeadline: number, maxRetries: number) {
  // apid's cold-boot readiness window caps startup at 30 seconds on paid plans.
  const deadline = plan === 'free' ? 15 : 30;
  const retries = plan === 'free' ? 3 : plan === 'hobby' ? 5 : plan === 'pro' ? 10 : 20;
  return {
    deadline:
      !Number.isInteger(startupDeadline) || startupDeadline < 0 || startupDeadline > deadline
        ? `Startup deadline must be 0 to ${deadline} seconds for this plan.`
        : undefined,
    retries:
      !Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > retries
        ? `Restart retries must be 0 to ${retries} for this plan.`
        : undefined,
  };
}

export function workerCreateRequest(input: {
  slug: string;
  memory: number;
  maxMemory: number;
  plan: Plan;
  restartPolicy: RestartPolicy;
  startupDeadline: number;
  maxRetries: number;
}): ImageCreateRequest {
  if (input.plan === 'free') throw new Error('Worker pools require Hobby or above.');
  if (!Number.isInteger(input.memory) || input.memory < 128 || input.memory > input.maxMemory)
    throw new Error('Select memory within your plan limit.');
  const errors = workerLifecycleErrors(input.plan, input.startupDeadline, input.maxRetries);
  if (errors.deadline) throw new Error(errors.deadline);
  if (errors.retries) throw new Error(errors.retries);
  return {
    slug: input.slug,
    type: 'app',
    ram_mb: input.memory,
    visibility: 'internal',
    execution_mode: 'worker',
    restart_policy: input.restartPolicy,
    startup_deadline_s: input.startupDeadline,
    max_retries: input.maxRetries,
  };
}
