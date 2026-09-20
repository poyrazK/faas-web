import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  FIELD,
  FieldError,
  fieldErrorProps,
  Select,
  Textarea,
  useFormValidation,
} from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useCreateJob, type Job } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { PlanGated } from './plan-gated';

const RESOURCE_FIELDS = [
  ['ram_mb', 'Memory (MB)'],
  ['task_timeout_sec', 'Task timeout (seconds)'],
  ['max_parallelism', 'Parallel tasks'],
  ['retry_max', 'Maximum retries'],
] as const;
type Resource = (typeof RESOURCE_FIELDS)[number][0];
type Field = 'name' | 'image' | 'executable' | 'arguments' | Resource;

/** The API receives argv, never a whitespace-split shell command. */
export function JobCreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (job: Job) => void;
}) {
  const create = useCreateJob();
  const resourceDetails = useRef<HTMLDetailsElement>(null);
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'batch' | 'recurring'>('batch');
  const [image, setImage] = useState('');
  const [executable, setExecutable] = useState('');
  const [args, setArgs] = useState('');
  const [resources, setResources] = useState<Record<Resource, string>>({
    ram_mb: '',
    task_timeout_sec: '',
    max_parallelism: '',
    retry_max: '',
  });
  const { submitAttempted, validate } = useFormValidation<Field>();
  const command = executable.trim() ? [executable.trim(), ...(args ? args.split('\n') : [])] : [];
  const errors: Partial<Record<Field, string>> = {};
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(name.trim()))
    errors.name =
      'Use 3–40 lowercase letters, digits or hyphens. Start and end with a letter or digit.';
  if (!image.trim()) errors.image = 'Enter a container image reference.';
  if (!executable.trim()) errors.executable = 'Enter the executable to run inside the container.';
  if (command.length > 64) errors.arguments = 'Use at most 63 arguments.';
  for (const [key] of RESOURCE_FIELDS) {
    const value = resources[key];
    if (value && (!Number.isSafeInteger(Number(value)) || Number(value) < 1))
      errors[key] = 'Enter a positive whole number, or leave blank for the plan default.';
  }
  const errorFor = (field: Field) => (submitAttempted ? errors[field] : undefined);
  const complaint = (field: Field) =>
    errorFor(field) ? <FieldError id={`job-${field}-error`}>{errors[field]}</FieldError> : null;
  const close = () => {
    if (!create.isPending) onClose();
  };

  return (
    <Modal
      open
      onClose={close}
      title="New workload"
      description="Define a container job. Creating it does not start a run."
      width="max-w-xl"
      footer={
        <>
          <Button type="button" variant="ghost" disabled={create.isPending} onClick={close}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="create-workload-form"
            aria-label="Create workload"
            busy={create.isPending}
          >
            Create workload
          </Button>
        </>
      }
    >
      <form
        id="create-workload-form"
        noValidate
        className="max-h-[calc(100dvh-17rem)] space-y-5 overflow-y-auto p-1"
        onSubmit={async (event) => {
          event.preventDefault();
          if (resourceDetails.current && RESOURCE_FIELDS.some(([key]) => errors[key]))
            resourceDetails.current.open = true;
          if (create.isPending || !validate(errors, event.currentTarget)) return;
          const overrides: Partial<Record<Resource, number>> = {};
          for (const [key] of RESOURCE_FIELDS)
            if (resources[key]) overrides[key] = Number(resources[key]);
          try {
            const job = await create.mutateAsync({
              name: name.trim(),
              kind,
              image_ref: image.trim(),
              command,
              ...overrides,
            });
            toast({
              kind: 'success',
              title: 'Workload created',
              description: `${job.name} is ready for its first run.`,
            });
            onCreated(job);
          } catch {
            /* Mutation error stays beside the draft for correction or retry. */
          }
        }}
      >
        <fieldset disabled={create.isPending} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <div className="space-y-1.5">
              <label htmlFor="job-name" className="text-xs font-medium">
                Name
              </label>
              <input
                id="job-name"
                name="name"
                className={`${FIELD} w-full`}
                placeholder="nightly-export"
                value={name}
                onChange={(e) => setName(e.target.value)}
                {...fieldErrorProps(errorFor('name'), 'job-name-error')}
              />
              {complaint('name')}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="job-kind" className="text-xs font-medium">
                Kind
              </label>
              <Select
                id="job-kind"
                className="w-full"
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="batch">Batch</option>
                <option value="recurring">Recurring</option>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="job-image" className="text-xs font-medium">
              Container image
            </label>
            <input
              id="job-image"
              name="image"
              className={`${FIELD} w-full font-mono`}
              placeholder="ghcr.io/acme/export:v1"
              value={image}
              onChange={(e) => setImage(e.target.value)}
              {...fieldErrorProps(errorFor('image'), 'job-image-error')}
            />
            {complaint('image')}
            <p className="text-xs text-muted-foreground">
              Use an image tag or pin a digest for repeatable runs.
            </p>
          </div>
          <div className="space-y-3 rounded-lg border border-border bg-background/40 p-4">
            <div>
              <h3 className="text-xs font-medium">Command</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                The process each task runs inside your container.
              </p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="job-executable" className="text-xs font-medium">
                Executable
              </label>
              <input
                id="job-executable"
                name="executable"
                className={`${FIELD} w-full font-mono`}
                placeholder="python"
                value={executable}
                onChange={(e) => setExecutable(e.target.value)}
                {...fieldErrorProps(errorFor('executable'), 'job-executable-error')}
              />
              {complaint('executable')}
            </div>
            <div className="space-y-1.5">
              <label htmlFor="job-arguments" className="text-xs font-medium">
                Arguments
              </label>
              <Textarea
                id="job-arguments"
                name="arguments"
                className="font-mono"
                placeholder={'-m\netl.run'}
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                {...fieldErrorProps(errorFor('arguments'), 'job-arguments-error')}
              />
              {complaint('arguments')}
              <p className="text-xs text-muted-foreground">
                One argument per line. Spaces and quotes are passed literally.
              </p>
            </div>
          </div>
          <details ref={resourceDetails} className="rounded-lg border border-border p-4">
            <summary className="cursor-pointer text-xs font-medium">
              Resource limits{' '}
              <span className="font-normal text-muted-foreground">· plan defaults</span>
            </summary>
            <p className="mb-3 mt-2 text-xs text-muted-foreground">
              Leave blank to use your plan’s defaults. Custom values must stay within its limits.
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {RESOURCE_FIELDS.map(([key, label]) => (
                <div key={key} className="space-y-1.5">
                  <label htmlFor={`job-${key}`} className="text-xs font-medium">
                    {label}
                  </label>
                  <input
                    id={`job-${key}`}
                    name={key}
                    type="number"
                    min="1"
                    step="1"
                    placeholder="Plan default"
                    className={`${FIELD} w-full`}
                    value={resources[key]}
                    onChange={(e) => setResources({ ...resources, [key]: e.target.value })}
                    {...fieldErrorProps(errorFor(key), `job-${key}-error`)}
                  />
                  {complaint(key)}
                </div>
              ))}
            </div>
          </details>
        </fieldset>
        {create.error && (
          <PlanGated error={create.error} feature="Jobs">
            <p role="alert" className="text-sm text-[color:var(--status-critical)]">
              {errorMessage(create.error)}
            </p>
          </PlanGated>
        )}
      </form>
    </Modal>
  );
}
