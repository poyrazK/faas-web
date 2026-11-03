import { useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, Textarea, fieldErrorProps } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useStartJobRun, type Job } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import {
  failureRulesErrors,
  failureRulesFrom,
  isManifestDigest,
  isManifestUri,
  MAX_RUN_TASKS,
  NO_FAILURE_RULES,
  parseEnvLines,
  parseRunInputs,
} from '@/lib/job-drafts';
import { FailureRulesFields } from './failure-rules-fields';
import { useScheduleClock } from './schedule-field';
import { SegmentedControl } from './tabs';

/**
 * Start one run of a workload, with the options `POST /v1/jobs/{name}/runs`
 * takes (faas handlers_jobs.go:1205-1488; docs/jobs.md):
 *
 * - **What to run:** a task count; an ordered input list, one task per
 *   `ID=REF` with the identity kept across retries; or an `obj://` input
 *   manifest verified against its SHA-256.
 * - **When:** standard runs have dispatch priority. A flexible run starts
 *   each task when capacity allows inside a window of at most 24 hours, and
 *   any task not started by its end is cancelled.
 * - **How failures land:** `continue` (the default) lets the other tasks
 *   carry on; `fail_fast` cancels tasks not yet started once one fails for
 *   good. The run may also bring its own failure rules.
 * - **Per-run overrides:** arguments after the job's executable, parallelism,
 *   retries, task timeout and environment, each inheriting the job's when
 *   blank.
 *
 * Every option is checked the way apid checks it, beside its field, and the
 * confirm says what the run will do. Tasks are billable, so the request
 * carries one idempotency key per intent: an unknown outcome is retried with
 * the same key, and any change to the request mints a new one.
 */

type RunRequest = components['schemas']['CreateJobRunRequest'];
export type RunAttempt = { body: string; key: string };
type Source = 'count' | 'inputs' | 'manifest';
type Field =
  | 'tasks'
  | 'inputs'
  | 'manifest-uri'
  | 'manifest-sha'
  | 'eligible-at'
  | 'latest-start-at'
  | 'arguments'
  | 'parallelism'
  | 'retry-max'
  | 'task-timeout'
  | 'env';

const plural = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'task' : 'tasks'}`;
const DAY = 24 * 3_600_000;

/** `datetime-local` speaks local wall time; the API wants an instant. */
const instant = (value: string) => {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
};

type JobDefaults = Pick<
  Job,
  'command' | 'max_parallelism' | 'retry_max' | 'task_timeout_sec' | 'failure_rules'
>;

const OVERRIDES = [
  {
    field: 'parallelism',
    key: 'parallelism',
    label: 'Parallel tasks',
    min: 1,
    unit: 'parallel tasks',
    from: 'max_parallelism',
  },
  {
    field: 'retry-max',
    key: 'retry_max',
    label: 'Retries per task',
    min: 0,
    unit: 'retries',
    from: 'retry_max',
  },
  {
    field: 'task-timeout',
    key: 'task_timeout_sec',
    label: 'Task timeout (seconds)',
    min: 1,
    unit: 'seconds',
    from: 'task_timeout_sec',
  },
] as const;

export function JobRunDialog({
  name,
  job,
  attempts,
  onClose,
  onStarted,
}: {
  name: string;
  /** The definition the run inherits from, for its hints; absent while it loads. */
  job?: JobDefaults;
  attempts: RefObject<Map<string, RunAttempt>>;
  onClose: () => void;
  onStarted: (runId: string) => void;
}) {
  const start = useStartJobRun();
  const confirm = useConfirm();
  const { toast } = useToast();
  const options = useRef<HTMLDetailsElement>(null);
  const [source, setSource] = useState<Source>('count');
  const [tasks, setTasks] = useState('1');
  const [inputs, setInputs] = useState('');
  const [manifestUri, setManifestUri] = useState('');
  const [manifestSha, setManifestSha] = useState('');
  const [flexible, setFlexible] = useState(false);
  const [eligibleAt, setEligibleAt] = useState('');
  const [latestStartAt, setLatestStartAt] = useState('');
  const [failFast, setFailFast] = useState(false);
  const [replaceArgs, setReplaceArgs] = useState(false);
  const [args, setArgs] = useState('');
  const [overrides, setOverrides] = useState({
    parallelism: '',
    'retry-max': '',
    'task-timeout': '',
  });
  const [env, setEnv] = useState('');
  const [rules, setRules] = useState(NO_FAILURE_RULES);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const now = useScheduleClock();
  const executable = job?.command?.[0];
  const count = Number(tasks);
  const parsedInputs = source === 'inputs' ? parseRunInputs(inputs) : {};
  const parsedEnv = parseEnvLines(env, { reservePlatform: true });
  const ruleErrors = failureRulesErrors(rules);
  const argList = args ? args.split('\n') : [];

  const errors: Partial<Record<Field | string, string>> = {};
  if (
    source === 'count' &&
    (!tasks.trim() || !Number.isSafeInteger(count) || count < 1 || count > MAX_RUN_TASKS)
  )
    errors.tasks = `Enter a whole number from 1 to ${MAX_RUN_TASKS}.`;
  if (source === 'inputs' && parsedInputs.error) errors.inputs = parsedInputs.error;
  if (source === 'manifest') {
    if (!isManifestUri(manifestUri.trim()))
      errors['manifest-uri'] = 'Enter an object as obj://APP_ID/BUCKET_ID/KEY.';
    if (!isManifestDigest(manifestSha.trim()))
      errors['manifest-sha'] =
        'Enter sha256: and the 64 lowercase hex digits of the file’s exact bytes.';
  }
  const eligible = eligibleAt ? instant(eligibleAt) : now;
  const latest = instant(latestStartAt);
  if (flexible) {
    if (eligibleAt && eligible === undefined) errors['eligible-at'] = 'Enter a valid time.';
    if (latest === undefined)
      errors['latest-start-at'] = 'A flexible run needs a latest start time.';
    else if (
      eligible !== undefined &&
      (latest <= Math.max(eligible, now) || latest - Math.max(eligible, now) > DAY)
    )
      errors['latest-start-at'] =
        'Make it later than the earliest start, and within 24 hours of it.';
  }
  if (replaceArgs) {
    if (!executable)
      errors.arguments = 'This workload has no executable whose arguments can be replaced.';
    else if (argList.length + 1 > 64) errors.arguments = 'Use at most 63 arguments.';
  }
  for (const { field, min } of OVERRIDES) {
    const value = overrides[field];
    if (value.trim() && (!Number.isSafeInteger(Number(value)) || Number(value) < min))
      errors[field] = `Enter a whole number of at least ${min}, or leave blank to inherit.`;
  }
  if (parsedEnv.error) errors.env = parsedEnv.error;
  ruleErrors.rules?.forEach((message, index) => {
    if (message) errors[`run-rules-rule-${index}-codes`] = message;
  });
  const shown = (field: Field) => (attempted ? errors[field] : undefined);
  const complaint = (field: Field) =>
    shown(field) ? <FieldError id={`run-${field}-error`}>{errors[field]}</FieldError> : null;
  const close = () => {
    if (!start.isPending) onClose();
  };

  /** The request as it will be sent: only what was set, so a default run stays `{ tasks }`. */
  const request = (): RunRequest => {
    const body: RunRequest = {};
    if (source === 'count') body.tasks = count;
    if (source === 'inputs') body.inputs = parsedInputs.inputs;
    if (source === 'manifest') {
      body.input_manifest_uri = manifestUri.trim();
      body.input_manifest_sha256 = manifestSha.trim();
    }
    if (flexible) {
      body.execution_class = 'flexible';
      if (eligibleAt && eligible !== undefined) body.eligible_at = new Date(eligible).toISOString();
      if (latest !== undefined) body.latest_start_at = new Date(latest).toISOString();
    }
    if (failFast) body.failure_policy = 'fail_fast';
    if (replaceArgs) body.arguments = argList;
    for (const { field, key } of OVERRIDES)
      if (overrides[field].trim()) body[key] = Number(overrides[field]);
    if (parsedEnv.env && Object.keys(parsedEnv.env).length) body.env_overrides = parsedEnv.env;
    const runRules = failureRulesFrom(rules);
    if (runRules) body.failure_rules = runRules;
    return body;
  };

  const describe = (body: RunRequest): string => {
    const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : 'now');
    return [
      'This starts real tasks on your account, and tasks that run are billable. The run is queued first.',
      body.input_manifest_uri
        ? 'Gregale reads the manifest, checks its bytes against the digest, and creates one task per entry.'
        : '',
      body.execution_class === 'flexible'
        ? `Tasks start when capacity allows between ${when(body.eligible_at)} and ${when(body.latest_start_at)}; any not started by then are cancelled.`
        : '',
      body.failure_policy === 'fail_fast'
        ? 'Once a task fails for good, tasks that have not started are cancelled.'
        : 'If a task fails for good, the others carry on.',
      body.arguments ? `Each task runs ${[executable, ...body.arguments].join(' ')}.` : '',
      OVERRIDES.filter(({ key }) => body[key] !== undefined).length
        ? `For this run: ${OVERRIDES.filter(({ key }) => body[key] !== undefined)
            .map(({ key, unit }) => `${body[key]} ${unit}`)
            .join(', ')}.`
        : '',
      body.env_overrides
        ? `${Object.keys(body.env_overrides).length === 1 ? 'One environment variable is' : `${Object.keys(body.env_overrides).length} environment variables are`} added for this run.`
        : '',
      body.failure_rules
        ? 'Failures are classified by this run’s own rules, not the workload’s.'
        : '',
      'Cancelling later stops tasks still in flight; work already done is not rolled back.',
    ]
      .filter(Boolean)
      .join(' ');
  };

  const submit = async () => {
    setAttempted(true);
    setFailure(null);
    if (Object.values(errors).some(Boolean)) {
      if (
        options.current &&
        Object.keys(errors).some(
          (key) => key !== 'tasks' && key !== 'inputs' && !key.startsWith('manifest')
        )
      )
        options.current.open = true;
      return;
    }
    if (start.isPending) return;
    const body = request();
    const size = body.tasks ?? body.inputs?.length;
    if (
      !(await confirm({
        title: size
          ? `Start ${plural(size)} of ${name}?`
          : `Start a run of ${name} from an input manifest?`,
        description: describe(body),
        confirmLabel: 'Start run',
        destructive: true,
      }))
    )
      return;
    const intent = JSON.stringify(body);
    let attempt = attempts.current.get(name);
    if (attempt?.body !== intent) {
      attempt = { body: intent, key: crypto.randomUUID() };
      attempts.current.set(name, attempt);
    }
    try {
      const run = await start.mutateAsync({ name, idempotencyKey: attempt.key, ...body });
      attempts.current.delete(name);
      toast({
        kind: 'success',
        title: 'Run queued',
        description: `${plural(run.tasks)} of ${name} queued. They have not run yet; follow progress in the run list.`,
      });
      onStarted(run.id);
    } catch (err) {
      // apid stores almost every answer under the key for 24 h, refusals
      // included, so reusing it after an ApiError would replay that refusal.
      // Keep it only when the outcome is unknown (network failure).
      if (err instanceof ApiError) attempts.current.delete(name);
      setFailure(failureMessage(err, body));
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={`Start a run of ${name}`}
      description="Each task runs your container once. Parallelism, retries and timeout come from the workload unless you override them."
      width="max-w-xl"
      footer={
        <>
          <Button type="button" variant="ghost" disabled={start.isPending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="start-run-form" busy={start.isPending}>
            Continue
          </Button>
        </>
      }
    >
      <form
        id="start-run-form"
        noValidate
        className="max-h-[calc(100dvh-17rem)] space-y-4 overflow-y-auto p-1"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={start.isPending} className="space-y-4">
          <SegmentedControl
            label="Tasks from"
            value={source}
            onChange={setSource}
            options={[
              { key: 'count', label: 'A count' },
              { key: 'inputs', label: 'Input list' },
              { key: 'manifest', label: 'Input manifest' },
            ]}
          />
          {source === 'count' && (
            <div className="space-y-1.5">
              <label htmlFor="run-tasks" className="text-xs font-medium">
                Number of tasks
              </label>
              <input
                id="run-tasks"
                name="tasks"
                type="number"
                min="1"
                max={MAX_RUN_TASKS}
                step="1"
                autoFocus
                className={`${FIELD} w-full`}
                value={tasks}
                onChange={(e) => setTasks(e.target.value)}
                {...fieldErrorProps(shown('tasks'), 'run-tasks-error')}
              />
              {complaint('tasks')}
              <p className="text-xs text-muted-foreground">
                Plans cap a run at 100 (Hobby), 1,000 (Pro) or 5,000 (Scale) tasks. Each task sees
                its index in GREGALE_TASK_INDEX.
              </p>
            </div>
          )}
          {source === 'inputs' && (
            <div className="space-y-1.5">
              <label htmlFor="run-inputs" className="text-xs font-medium">
                Inputs
              </label>
              <Textarea
                id="run-inputs"
                name="inputs"
                className="font-mono"
                placeholder={'shard-a=s3://my-bucket/a\nshard-b=s3://my-bucket/b'}
                value={inputs}
                onChange={(e) => setInputs(e.target.value)}
                {...fieldErrorProps(shown('inputs'), 'run-inputs-error')}
              />
              {complaint('inputs')}
              <p className="text-xs text-muted-foreground">
                One ID=REFERENCE per line; each line is one task, in order. The task reads them as
                GREGALE_INPUT_ID and GREGALE_INPUT_REF, keeps them across retries, and Replay failed
                reruns exactly the inputs that failed. The reference is passed as written; your
                image fetches it.
              </p>
            </div>
          )}
          {source === 'manifest' && (
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <label htmlFor="run-manifest-uri" className="text-xs font-medium">
                  Manifest object
                </label>
                <input
                  id="run-manifest-uri"
                  name="manifest-uri"
                  className={`${FIELD} w-full font-mono`}
                  placeholder="obj://APP_ID/BUCKET_ID/inputs.json"
                  value={manifestUri}
                  onChange={(e) => setManifestUri(e.target.value)}
                  {...fieldErrorProps(shown('manifest-uri'), 'run-manifest-uri-error')}
                />
                {complaint('manifest-uri')}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="run-manifest-sha" className="text-xs font-medium">
                  Manifest SHA-256
                </label>
                <input
                  id="run-manifest-sha"
                  name="manifest-sha"
                  className={`${FIELD} w-full font-mono`}
                  placeholder="sha256:…"
                  value={manifestSha}
                  onChange={(e) => setManifestSha(e.target.value)}
                  {...fieldErrorProps(shown('manifest-sha'), 'run-manifest-sha-error')}
                />
                {complaint('manifest-sha')}
              </div>
              <p className="text-xs text-muted-foreground">
                A JSON array of {'{"input_id", "input_ref"}'} objects of up to 16 MiB in one of your
                buckets. Its exact bytes must match the digest; each entry becomes one task.
              </p>
            </div>
          )}

          <details ref={options} className="rounded-lg border border-border p-4">
            <summary className="cursor-pointer text-xs font-medium">
              Run options{' '}
              <span className="font-normal text-muted-foreground">
                · start window, failures, arguments, overrides
              </span>
            </summary>
            <div className="mt-4 space-y-5">
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={flexible}
                    onChange={(e) => setFlexible(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">Flexible start window</span>
                    <span className="block text-muted-foreground">
                      Tasks start when spare capacity allows, after standard work. Any task not
                      started by the latest start is cancelled; a started task keeps its normal
                      timeout. Priced as a standard run.
                    </span>
                  </span>
                </label>
                {flexible && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor="run-eligible-at" className="text-xs font-medium">
                        Earliest start
                      </label>
                      <input
                        id="run-eligible-at"
                        name="eligible-at"
                        type="datetime-local"
                        className={`${FIELD} w-full`}
                        value={eligibleAt}
                        onChange={(e) => setEligibleAt(e.target.value)}
                        {...fieldErrorProps(shown('eligible-at'), 'run-eligible-at-error')}
                      />
                      {complaint('eligible-at')}
                      <p className="text-xs text-muted-foreground">Blank is now.</p>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="run-latest-start-at" className="text-xs font-medium">
                        Latest start
                      </label>
                      <input
                        id="run-latest-start-at"
                        name="latest-start-at"
                        type="datetime-local"
                        className={`${FIELD} w-full`}
                        value={latestStartAt}
                        onChange={(e) => setLatestStartAt(e.target.value)}
                        {...fieldErrorProps(shown('latest-start-at'), 'run-latest-start-at-error')}
                      />
                      {complaint('latest-start-at')}
                      <p className="text-xs text-muted-foreground">
                        Within 24 hours of the earliest start. Times are your browser’s.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={failFast}
                  onChange={(e) => setFailFast(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Fail fast</span>
                  <span className="block text-muted-foreground">
                    Once a task fails for good, cancel the tasks that have not started. Tasks
                    already running may finish. Without it, the other tasks carry on.
                  </span>
                </span>
              </label>

              <div className="space-y-2">
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={replaceArgs}
                    onChange={(e) => setReplaceArgs(e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">Replace the arguments</span>
                    <span className="block text-muted-foreground">
                      {executable ? (
                        <>
                          Keep <span className="font-mono">{executable}</span> and run it with these
                          arguments instead. Leave the list empty to run it with none.
                        </>
                      ) : (
                        'Keeps the workload’s executable and replaces what follows it.'
                      )}
                    </span>
                  </span>
                </label>
                {replaceArgs && (
                  <div className="space-y-1.5">
                    <label htmlFor="run-arguments" className="text-xs font-medium">
                      Arguments
                    </label>
                    <Textarea
                      id="run-arguments"
                      name="arguments"
                      className="font-mono"
                      placeholder={'--dataset\n2026-09'}
                      value={args}
                      onChange={(e) => setArgs(e.target.value)}
                      {...fieldErrorProps(shown('arguments'), 'run-arguments-error')}
                    />
                    {complaint('arguments')}
                    <p className="text-xs text-muted-foreground">
                      One argument per line, passed literally.
                    </p>
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {OVERRIDES.map(({ field, label, min, from }) => (
                  <div key={field} className="space-y-1.5">
                    <label htmlFor={`run-${field}`} className="text-xs font-medium">
                      {label}
                    </label>
                    <input
                      id={`run-${field}`}
                      name={field}
                      type="number"
                      min={min}
                      step="1"
                      className={`${FIELD} w-full`}
                      placeholder={job?.[from] != null ? `${job[from]} (workload)` : 'Inherit'}
                      value={overrides[field]}
                      onChange={(e) => setOverrides({ ...overrides, [field]: e.target.value })}
                      {...fieldErrorProps(shown(field), `run-${field}-error`)}
                    />
                    {complaint(field)}
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="run-env" className="text-xs font-medium">
                  Environment for this run
                </label>
                <Textarea
                  id="run-env"
                  name="env"
                  className="font-mono"
                  placeholder="DATASET=2026-09"
                  value={env}
                  onChange={(e) => setEnv(e.target.value)}
                  {...fieldErrorProps(shown('env'), 'run-env-error')}
                />
                {complaint('env')}
                <p className="text-xs text-muted-foreground">
                  One KEY=VALUE per line, merged over the workload’s. GREGALE_ names are the
                  platform’s.
                </p>
              </div>

              <FailureRulesFields
                id="run-rules"
                value={rules}
                onChange={setRules}
                errors={attempted ? ruleErrors : undefined}
                toggleLabel="Use failure rules for this run only"
                toggleHint={
                  job?.failure_rules
                    ? 'Otherwise the workload’s own rules apply.'
                    : 'Otherwise every confirmed failure keeps its remaining retries.'
                }
              />
            </div>
          </details>
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

function failureMessage(err: unknown, body: RunRequest): string {
  // The plan cap refuses a value rather than clamping it; `limit` is the cap
  // and `observed` what was sent, which says which field crossed it. The
  // server prose also suggests cancelling a task, which does not apply here.
  if (err instanceof ApiError && err.code === 'job_quota_exceeded') {
    const cap = err.problem.limit;
    const observed = err.problem.observed;
    if (typeof cap === 'number') {
      const limit = cap.toLocaleString('en-US');
      const size = body.tasks ?? body.inputs?.length;
      const override = OVERRIDES.find(({ key }) => body[key] === observed);
      if (override && observed !== size) return `Your plan allows up to ${limit} ${override.unit}.`;
      return `Your plan allows up to ${limit} tasks per run.`;
    }
  }
  return errorMessage(err);
}
