import type { components } from '@/lib/api/schema';

type Deployment = components['schemas']['DeploymentResponse'];
type Build = components['schemas']['BuildResponse'];

export interface FailureSummary {
  cause: string;
  nextStep: string;
  code?: string;
  evidence: NonNullable<Deployment['error_relevant_logs']>;
}

const classLabel = {
  oom: 'The build ran out of memory.',
  timeout: 'The build exceeded its time limit.',
  user_error: 'The build reported an application error.',
  infra: 'The build reported an infrastructure error.',
} satisfies Record<NonNullable<Build['failure_class']>, string>;
const present = (text?: string | null) => text?.trim() || undefined;

/** Select reported evidence, never infer a diagnosis or an executable fix. */
export function failureSummary({
  deployment,
  build,
}: {
  deployment?: Deployment;
  build?: Build;
}): FailureSummary {
  return {
    cause:
      present(deployment?.error_why) ??
      present(deployment?.error) ??
      (build?.failure_class ? classLabel[build.failure_class] : undefined) ??
      'No failure explanation was recorded.',
    nextStep:
      present(deployment?.error_fix) ??
      present(deployment?.error_hint) ??
      'Review the build output for more detail.',
    code: present(deployment?.error_code),
    evidence: (deployment?.error_relevant_logs ?? []).filter((row) => present(row.message)),
  };
}
