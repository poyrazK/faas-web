import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  FIELD,
  FieldError,
  Textarea,
  fieldErrorProps,
  useFormValidation,
} from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useUpdateJobDefinition, type UpdateJobDefinition } from '@/lib/api/jobs';
import type { Job } from '@/lib/api/queries';
import {
  envLinesFrom,
  failureRulesDraftFrom,
  failureRulesErrors,
  failureRulesFrom,
  parseEnvLines,
} from '@/lib/job-drafts';
import { FailureRulesFields } from './failure-rules-fields';

/**
 * Edit what a workload runs: image, command, environment, resources and the
 * failure rules its tasks are classified by (`PATCH /v1/jobs/{name}`;
 * handlers_jobs.go:976-1150). Only changed fields are sent, since a PATCH
 * leaves anything absent untouched.
 *
 * Each run captures its image, command, environment, resources and rules
 * when it starts (docs/jobs.md), so an edit changes runs started afterwards
 * and never one already recorded; apid refuses it outright while a task is
 * queued or claimed. A new image reference is pulled and prepared again
 * (pgstore_jobs.go:361-372), and runs started meanwhile wait for it. The
 * schedule is edited on its own, beside the definition.
 */

const RESOURCES = [
  { key: 'ram_mb', label: 'Memory (MB)', min: 64, unit: 'MB' },
  { key: 'task_timeout_sec', label: 'Task timeout (seconds)', min: 1, unit: 'seconds' },
  { key: 'max_parallelism', label: 'Parallel tasks', min: 1, unit: 'parallel tasks' },
  { key: 'retry_max', label: 'Retries per task', min: 0, unit: 'retries' },
] as const;
type Resource = (typeof RESOURCES)[number]['key'];
type Field = 'image' | 'executable' | 'arguments' | 'env' | Resource;

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);
const sameEnv = (a: Record<string, string>, b: Record<string, string>) =>
  sameList(Object.keys(a).sort(), Object.keys(b).sort()) &&
  Object.entries(a).every(([key, value]) => b[key] === value);

const LABEL: Record<keyof UpdateJobDefinition, string> = {
  image_ref: 'image',
  command: 'command',
  env_overrides: 'environment',
  ram_mb: 'memory',
  task_timeout_sec: 'task timeout',
  max_parallelism: 'parallelism',
  retry_max: 'retries',
  failure_rules: 'failure rules',
};

export function JobEditDialog({ job, onClose }: { job: Job; onClose: () => void }) {
  const update = useUpdateJobDefinition();
  const confirm = useConfirm();
  const { toast } = useToast();
  const { submitAttempted, validate } = useFormValidation<Field | string>();
  const [image, setImage] = useState(job.image_ref);
  const [executable, setExecutable] = useState(job.command[0] ?? '');
  const [args, setArgs] = useState(job.command.slice(1).join('\n'));
  const [env, setEnv] = useState(envLinesFrom(job.env_overrides));
  const [resources, setResources] = useState<Record<Resource, string>>({
    ram_mb: String(job.ram_mb),
    task_timeout_sec: String(job.task_timeout_sec),
    max_parallelism: String(job.max_parallelism),
    retry_max: String(job.retry_max),
  });
  const [rules, setRules] = useState(() => failureRulesDraftFrom(job.failure_rules));
  const [failure, setFailure] = useState<string | null>(null);

  const command = executable.trim() ? [executable.trim(), ...(args ? args.split('\n') : [])] : [];
  const parsedEnv = parseEnvLines(env);
  const ruleErrors = failureRulesErrors(rules);
  const errors: Partial<Record<Field | string, string>> = {};
  if (!image.trim()) errors.image = 'Enter a container image reference.';
  if (!executable.trim()) errors.executable = 'Enter the executable to run inside the container.';
  if (command.length > 64) errors.arguments = 'Use at most 63 arguments.';
  if (parsedEnv.error) errors.env = parsedEnv.error;
  for (const { key, min } of RESOURCES) {
    const n = Number(resources[key]);
    if (!resources[key].trim() || !Number.isSafeInteger(n) || n < min)
      errors[key] =
        key === 'ram_mb'
          ? 'Enter at least 64 MB, the smallest guest that boots.'
          : `Enter a whole number of at least ${min}.`;
  }
  ruleErrors.rules?.forEach((message, index) => {
    if (message) errors[`edit-rules-rule-${index}-codes`] = message;
  });
  const errorFor = (field: Field) => (submitAttempted ? errors[field] : undefined);
  const complaint = (field: Field) =>
    errorFor(field) ? <FieldError id={`edit-${field}-error`}>{errors[field]}</FieldError> : null;
  const close = () => {
    if (!update.isPending) onClose();
  };

  /** Only what differs from the stored job; PATCH leaves the rest alone. */
  const changes = (): UpdateJobDefinition => {
    const patch: UpdateJobDefinition = {};
    if (image.trim() !== job.image_ref) patch.image_ref = image.trim();
    if (!sameList(command, job.command)) patch.command = command;
    if (parsedEnv.env && !sameEnv(parsedEnv.env, job.env_overrides ?? {}))
      patch.env_overrides = parsedEnv.env;
    for (const { key } of RESOURCES) {
      const n = Number(resources[key]);
      if (n !== job[key]) patch[key] = n;
    }
    const nextRules = failureRulesFrom(rules);
    if (nextRules && JSON.stringify(nextRules) !== JSON.stringify(job.failure_rules))
      patch.failure_rules = nextRules;
    return patch;
  };

  const submit = async (form: HTMLFormElement) => {
    setFailure(null);
    if (update.isPending || !validate(errors, form)) return;
    const patch = changes();
    const fields = Object.keys(patch) as (keyof UpdateJobDefinition)[];
    if (fields.length === 0) {
      setFailure('Nothing has changed.');
      return;
    }
    const consequences = [
      `This changes the ${fields.map((field) => LABEL[field]).join(', ')} of ${job.name}.`,
      'Runs started from now on use the new definition; runs already recorded keep what they captured.',
      patch.image_ref
        ? 'The new image is pulled and prepared before any task starts, and runs wait for it; if it cannot be pulled, new runs are refused until the image is fixed.'
        : '',
      patch.failure_rules
        ? 'Failed tasks in later runs are retried or stopped by the new rules.'
        : '',
      patch.retry_max !== undefined
        ? `Each task in later runs gets ${patch.retry_max} ${patch.retry_max === 1 ? 'retry' : 'retries'}.`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (
      !(await confirm({
        title: `Save changes to ${job.name}?`,
        description: consequences,
        confirmLabel: 'Save changes',
      }))
    )
      return;
    try {
      const saved = await update.mutateAsync({ name: job.name, ...patch });
      toast({
        kind: 'success',
        title: 'Workload updated',
        description: patch.image_ref
          ? `${saved.name} is preparing its new image; runs start once it is ready.`
          : `The next run of ${saved.name} uses the new definition.`,
      });
      onClose();
    } catch (err) {
      setFailure(failureMessage(err, patch));
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={`Edit ${job.name}`}
      description="Change what each task runs. Runs already recorded keep the definition they started with."
      width="max-w-xl"
      footer={
        <>
          <Button type="button" variant="ghost" disabled={update.isPending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="edit-workload-form" busy={update.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <form
        id="edit-workload-form"
        noValidate
        className="max-h-[calc(100dvh-17rem)] space-y-5 overflow-y-auto p-1"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(event.currentTarget);
        }}
      >
        <fieldset disabled={update.isPending} className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="edit-image" className="text-xs font-medium">
              Container image
            </label>
            <input
              id="edit-image"
              name="image"
              className={`${FIELD} w-full font-mono`}
              value={image}
              onChange={(e) => setImage(e.target.value)}
              {...fieldErrorProps(errorFor('image'), 'edit-image-error')}
            />
            {complaint('image')}
            {image.trim() !== job.image_ref && image.trim() && (
              <p className="text-xs text-[color:var(--status-warning)]">
                A new image is pulled and prepared again before the next task starts.
              </p>
            )}
          </div>
          <div className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
            <h3 className="text-xs font-medium">Command</h3>
            <div className="space-y-1.5">
              <label htmlFor="edit-executable" className="text-xs font-medium">
                Executable
              </label>
              <input
                id="edit-executable"
                name="executable"
                className={`${FIELD} w-full font-mono`}
                value={executable}
                onChange={(e) => setExecutable(e.target.value)}
                {...fieldErrorProps(errorFor('executable'), 'edit-executable-error')}
              />
              {complaint('executable')}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="edit-arguments" className="text-xs font-medium">
                Arguments
              </label>
              <Textarea
                id="edit-arguments"
                name="arguments"
                className="font-mono"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                {...fieldErrorProps(errorFor('arguments'), 'edit-arguments-error')}
              />
              {complaint('arguments')}
              <p className="text-xs text-muted-foreground">
                One argument per line. Spaces and quotes are passed literally.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="edit-env" className="text-xs font-medium">
              Environment overrides
            </label>
            <Textarea
              id="edit-env"
              name="env"
              className="font-mono"
              placeholder="LOG_LEVEL=info"
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              {...fieldErrorProps(errorFor('env'), 'edit-env-error')}
            />
            {complaint('env')}
            <p className="text-xs text-muted-foreground">
              One KEY=VALUE per line. Saving replaces the whole set; values are stored as written,
              so keep secrets out of them.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {RESOURCES.map(({ key, label, min }) => (
              <div key={key} className="space-y-1.5">
                <label htmlFor={`edit-${key}`} className="text-xs font-medium">
                  {label}
                </label>
                <input
                  id={`edit-${key}`}
                  name={key}
                  type="number"
                  min={min}
                  step="1"
                  className={`${FIELD} w-full`}
                  value={resources[key]}
                  onChange={(e) => setResources({ ...resources, [key]: e.target.value })}
                  {...fieldErrorProps(errorFor(key), `edit-${key}-error`)}
                />
                {complaint(key)}
              </div>
            ))}
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Values must stay within your plan’s job limits.
          </p>
          <div className="rounded-lg border border-border p-4">
            <FailureRulesFields
              id="edit-rules"
              value={rules}
              onChange={setRules}
              errors={submitAttempted ? ruleErrors : undefined}
              lockedOn={Boolean(job.failure_rules)}
              toggleLabel="Classify failures with explicit rules"
              toggleHint="Without rules, every confirmed failure keeps its remaining retries."
            />
          </div>
        </fieldset>
        {failure && (
          <p role="alert" className="text-sm text-[color:var(--status-critical)]">
            {failure}
          </p>
        )}
      </form>
    </Modal>
  );
}

function failureMessage(err: unknown, patch: UpdateJobDefinition): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  // apid answers 409 validation_failed while any task is queued or claimed
  // (handlers_jobs.go:1136-1140); 409 image_run_managed is an image run's.
  if (err.status === 409 && err.code === 'validation_failed')
    return 'This workload has tasks queued or running. Wait for them to finish or cancel those runs, then save again.';
  if (err.code === 'job_quota_exceeded' && typeof err.problem.limit === 'number') {
    const over = RESOURCES.find(({ key }) => patch[key] === err.problem.observed);
    return over
      ? `Your plan allows up to ${err.problem.limit.toLocaleString('en-US')} ${over.unit} here.`
      : errorMessage(err);
  }
  return errorMessage(err);
}
