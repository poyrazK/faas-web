import type { components } from './api/schema';
import type { ImageCreateRequest } from './image-operation';

type Plan = components['schemas']['CapabilitiesResponse']['plan'];
type RestartPolicy = NonNullable<ImageCreateRequest['restart_policy']>;

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
  const limits =
    input.plan === 'hobby'
      ? { deadline: 30, retries: 5 }
      : input.plan === 'pro'
        ? { deadline: 60, retries: 10 }
        : { deadline: 120, retries: 20 };
  if (
    !Number.isInteger(input.startupDeadline) ||
    input.startupDeadline < 0 ||
    input.startupDeadline > limits.deadline
  )
    throw new Error(`Startup deadline must be 0 to ${limits.deadline} seconds for this plan.`);
  if (
    !Number.isInteger(input.maxRetries) ||
    input.maxRetries < 0 ||
    input.maxRetries > limits.retries
  )
    throw new Error(`Restart retries must be 0 to ${limits.retries} for this plan.`);
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
