import type { IncomingMessage, ServerResponse } from 'node:http';
import type { components } from '../src/lib/api/schema';

/**
 * Dev-mock answers for the parts of `/v1/jobs` past the basic lifecycle in
 * `mock/plugin.ts`: editing a definition, the run options, task attempt
 * history, schedule occurrences and live task output (faas
 * apidserver/handlers_jobs.go, handlers_schedule_occurrences.go;
 * gatewayd-internal/job_task_logs.go).
 *
 * Seeds: every finished task with `attempt > 1` failed its earlier attempts
 * with exit 1 and was retried; a recurring job has 60 hourly occurrences, so
 * a second page exists, with a skipped, a missed and a coalesced time among
 * them. A running (`claimed`) task's live output writes a line every 600 ms
 * and stays open, as a task still running would; a queued one waits; a
 * finished one ends with `stored_output`.
 */

type S = components['schemas'];
type Task = S['JobTaskResponse'];
type Attempt = S['JobTaskAttemptResponse'];
type Occurrence = S['ScheduleOccurrenceResponse'];

export interface JobRefusal {
  status: number;
  code: string;
  detail: string;
  extra?: Record<string, unknown>;
}

/** apid's per-plan job ceilings (pkg/api/limits.go:9475-9497; hobby, pro, scale). */
export function jobCaps(plan: string | undefined) {
  const tier = plan === 'hobby' ? 0 : plan === 'scale' ? 2 : 1;
  return {
    ram_mb: [512, 2048, 4096][tier]!,
    task_timeout_sec: [300, 1800, 3600][tier]!,
    max_parallelism: [10, 25, 50][tier]!,
    retry_max: [3, 5, 10][tier]!,
    tasks_per_run: [100, 1000, 5000][tier]!,
  };
}
type Caps = ReturnType<typeof jobCaps>;

const invalid = (detail: string): JobRefusal => ({
  status: 400,
  code: 'validation_failed',
  detail,
});
const quota = (name: string, limit: number, observed: number): JobRefusal => ({
  status: 403,
  code: 'job_quota_exceeded',
  detail: `pro plan caps jobs at ${limit} for ${name}; you have ${observed}. Cancel a task or delete a job to free capacity.`,
  extra: { limit, observed },
});
const isInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

/** pkg/workpolicy/scheduled_policy.go:66-105. */
export function failureRulesRefusal(rules: unknown): JobRefusal | undefined {
  if (rules === undefined) return undefined;
  const r = rules as Partial<S['FailureRules']>;
  if (r.version !== 1) return invalid('failure_rules.version must be 1');
  if (r.unmatched_failure !== 'retry' && r.unmatched_failure !== 'fail_partition')
    return invalid('failure_rules.unmatched_failure must be retry or fail_partition');
  if (r.uncertain_outcome !== 'hold' && r.uncertain_outcome !== 'retry')
    return invalid('failure_rules.uncertain_outcome must be hold or retry');
  if (!Array.isArray(r.rules) || r.rules.length > 64)
    return invalid('failure_rules may contain at most 64 rules and 16384 bytes');
  const exits = new Set<number>();
  const codes = new Set<string>();
  for (const rule of r.rules) {
    if (
      !['retry', 'fail_partition'].includes(rule.action) ||
      (rule.exit_codes?.length ?? 0) + (rule.outcome_codes?.length ?? 0) === 0
    )
      return invalid('each failure rule needs a matcher and retry or fail_partition action');
    for (const code of rule.exit_codes ?? []) {
      if (!isInt(code) || code < 1 || code > 255 || exits.has(code))
        return invalid(`exit code ${code} must be unique and between 1 and 255`);
      exits.add(code);
    }
    for (const code of rule.outcome_codes ?? []) {
      if (!/^[a-z0-9_.-]{1,64}$/.test(code) || codes.has(code))
        return invalid('outcome codes must be unique nonempty tokens of at most 64 bytes');
      codes.add(code);
    }
  }
  return undefined;
}

/** The definition half of PATCH /v1/jobs/{name} (handlers_jobs.go:976-1110). */
export function definitionRefusal(
  body: Record<string, unknown>,
  caps: Caps
): JobRefusal | undefined {
  if ('image_ref' in body && (typeof body.image_ref !== 'string' || !body.image_ref.trim()))
    return invalid('image_ref is required');
  if (
    'command' in body &&
    (!Array.isArray(body.command) ||
      body.command.length > 64 ||
      !body.command.every((arg) => typeof arg === 'string'))
  )
    return invalid('command array may contain at most 64 entries');
  if (
    'env_overrides' in body &&
    (typeof body.env_overrides !== 'object' ||
      body.env_overrides === null ||
      !Object.values(body.env_overrides).every((v) => typeof v === 'string'))
  )
    return invalid('env_overrides must map names to strings');
  if ('ram_mb' in body) {
    if (!isInt(body.ram_mb) || body.ram_mb < 64)
      return { ...invalid(`ram_mb must be at least 64 MB; requested ${String(body.ram_mb)} MB.`) };
    if (body.ram_mb > caps.ram_mb) return quota('ram_mb', caps.ram_mb, body.ram_mb);
  }
  if ('task_timeout_sec' in body) {
    if (!isInt(body.task_timeout_sec) || body.task_timeout_sec <= 0)
      return invalid('task_timeout_s must be positive');
    if (body.task_timeout_sec > caps.task_timeout_sec)
      return quota('task_timeout_s', caps.task_timeout_sec, body.task_timeout_sec);
  }
  if ('max_parallelism' in body) {
    if (!isInt(body.max_parallelism) || body.max_parallelism <= 0)
      return invalid('max_parallelism must be positive');
    if (body.max_parallelism > caps.max_parallelism)
      return quota('max_parallelism', caps.max_parallelism, body.max_parallelism);
  }
  if ('retry_max' in body) {
    if (!isInt(body.retry_max) || body.retry_max < 0)
      return invalid('retry_max must be non-negative');
    if (body.retry_max > caps.retry_max) return quota('retry_max', caps.retry_max, body.retry_max);
  }
  return failureRulesRefusal(body.failure_rules);
}

/** The definition fields a PATCH may change, beside status and the schedule. */
export const DEFINITION_FIELDS = [
  'image_ref',
  'command',
  'env_overrides',
  'ram_mb',
  'task_timeout_sec',
  'max_parallelism',
  'retry_max',
  'failure_rules',
] as const;

/**
 * POST /v1/jobs/{name}/runs, checked as createJobRun checks it
 * (handlers_jobs.go:1205-1420). Returns the task count, or the refusal.
 * The mock cannot read a manifest object, so one names a size in its key:
 * `…/inputs-12.json` fans out 12 tasks (3 otherwise).
 */
export function runRequestRefusal(
  body: Record<string, unknown>,
  job: { command: string[] },
  caps: Caps,
  now = Date.now()
): { refusal: JobRefusal } | { tasks: number } {
  const fail = (refusal: JobRefusal) => ({ refusal });
  const rulesRefusal = failureRulesRefusal(body.failure_rules);
  if (rulesRefusal) return fail(rulesRefusal);
  let tasks = isInt(body.tasks) ? body.tasks : 0;
  const uri = typeof body.input_manifest_uri === 'string' ? body.input_manifest_uri : '';
  const sha = typeof body.input_manifest_sha256 === 'string' ? body.input_manifest_sha256 : '';
  const inputs = Array.isArray(body.inputs) ? (body.inputs as S['JobRunInput'][]) : [];
  if (uri || sha) {
    if (!uri || !sha || inputs.length)
      return fail(
        invalid('supply both input_manifest_uri and input_manifest_sha256, without inline inputs')
      );
    if (!/^sha256:[0-9a-f]{64}$/.test(sha) || !uri.startsWith('obj://'))
      return fail(invalid('the manifest must be an obj:// object with a sha256: digest'));
    if (uri.includes('missing'))
      return fail({
        status: 404,
        code: 'object_not_found',
        detail: 'the manifest object does not exist',
      });
    tasks = Number(/inputs-(\d+)\.json$/.exec(uri)?.[1] ?? 3);
  } else if (inputs.length) {
    if (tasks && tasks !== inputs.length)
      return fail(invalid('tasks must equal the number of declared inputs'));
    const seen = new Set<string>();
    for (const input of inputs) {
      if (
        !input.input_id ||
        input.input_id.length > 128 ||
        !input.input_ref ||
        input.input_ref.length > 2048
      )
        return fail(
          invalid(
            'each input needs a nonempty input_id (up to 128 bytes) and input_ref (up to 2048 bytes)'
          )
        );
      if (seen.has(input.input_id))
        return fail(invalid('input_id values must be unique within a run'));
      seen.add(input.input_id);
    }
    tasks = inputs.length;
  }
  if (tasks < 1) return fail(invalid('tasks must be >= 1'));
  const flexible = body.execution_class === 'flexible';
  if (flexible) {
    const eligible = Math.max(now, Date.parse(String(body.eligible_at ?? '')) || now);
    const latest = Date.parse(String(body.latest_start_at ?? ''));
    if (!latest || latest <= eligible || latest - eligible > 24 * 3_600_000)
      return fail(invalid('latest_start_at must be after eligible_at and within 24 hours'));
  } else if (
    (body.execution_class !== undefined && body.execution_class !== 'standard') ||
    body.eligible_at !== undefined ||
    body.latest_start_at !== undefined
  )
    return fail(invalid('standard runs cannot specify a start window'));
  if (
    body.failure_policy !== undefined &&
    !['continue', 'fail_fast'].includes(String(body.failure_policy))
  )
    return fail(invalid('failure_policy must be continue or fail_fast'));
  if (tasks > caps.tasks_per_run) return fail(quota('tasks_per_run', caps.tasks_per_run, tasks));
  const overrides = [
    ['parallelism', 'max_parallelism', caps.max_parallelism, 1],
    ['task_timeout_sec', 'task_timeout_s', caps.task_timeout_sec, 1],
    ['retry_max', 'retry_max', caps.retry_max, 0],
  ] as const;
  for (const [key, name, cap, min] of overrides) {
    const value = body[key];
    if (value === undefined || value === null) continue;
    if (!isInt(value) || value < min)
      return fail(invalid(`${name} must be ${min ? 'positive' : 'non-negative'}`));
    if (value > cap) return fail(quota(name, cap, value));
  }
  if (body.arguments !== undefined) {
    if (!job.command.length)
      return fail(invalid('job command must have an executable to override arguments'));
    if (!Array.isArray(body.arguments) || body.arguments.length + 1 > 64)
      return fail(invalid('command may contain at most 64 entries'));
  }
  for (const key of Object.keys((body.env_overrides as Record<string, string>) ?? {})) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || key.startsWith('GREGALE_'))
      return fail(
        invalid('run environment variables must use customer keys and fit the plan value limit')
      );
  }
  return { tasks };
}

const iso = (ms: number) => new Date(ms).toISOString();
const HOUR = 3_600_000;

/**
 * The scheduler's record for a recurring job: newest first, one per hour,
 * mostly started runs (linked to the job's scheduled runs where there are
 * some), with each kind of recorded decision somewhere in the first page.
 */
export function occurrencesFor(
  job: { id: string; schedule_policy?: S['SchedulePolicy'] },
  scheduledRunIds: string[],
  now = Date.now()
): Occurrence[] {
  const top = Math.floor(now / HOUR) * HOUR;
  const policy = job.schedule_policy ?? { version: 1, overlap: 'allow', missed_runs: 'skip' };
  let runIndex = 0;
  return Array.from({ length: 60 }, (_, i): Occurrence => {
    const scheduled = top - i * HOUR;
    const seed = `${job.id.slice(0, 8)}-0000-4000-8000-${String(i).padStart(12, '0')}`;
    const base = {
      id: seed,
      schedule_revision: i < 30 ? 2 : 1,
      scheduled_for: iso(scheduled),
      schedule_policy: policy,
      created_at: iso(scheduled),
    };
    if (!job.schedule_policy || ![2, 5, 6].includes(i)) {
      const runId = scheduledRunIds[runIndex++];
      return {
        ...base,
        status: i === 0 ? 'running' : 'succeeded',
        ...(runId ? { job_run_id: runId } : {}),
        started_at: iso(scheduled + 4_000),
        ...(i === 0 ? {} : { finished_at: iso(scheduled + 95_000) }),
      };
    }
    if (i === 2)
      return {
        ...base,
        status: 'skipped_overlap',
        reason: 'a previous scheduled run was still queued or running',
      };
    if (i === 5)
      return {
        ...base,
        status: 'missed_deadline',
        start_deadline_at: iso(scheduled + 120_000),
        reason: 'start deadline expired before the scheduler could dispatch the occurrence',
      };
    return {
      ...base,
      status: 'coalesced',
      reason: 'an older missed occurrence was coalesced into the latest due occurrence',
    };
  });
}

export function occurrencePage(all: Occurrence[], query: URLSearchParams) {
  const limit = Number(query.get('limit') ?? 50);
  const before = query.get('before');
  const start = before ? all.findIndex((o) => o.id === before) + 1 : 0;
  const occurrences = all.slice(start, start + limit);
  return {
    occurrences,
    limit,
    ...(before ? { before } : {}),
    ...(occurrences.length === limit && start + limit < all.length
      ? { next_before: occurrences.at(-1)!.id }
      : {}),
  };
}

const IN_FLIGHT = new Set(['queued', 'claimed']);

/**
 * The finished attempts of a task: every attempt before the current one
 * failed with exit 1 and was retried, and the current one is listed once it
 * has finished (handlers_jobs.go:625-686).
 */
export function attemptsFor(task: Task): Attempt[] {
  const finished = IN_FLIGHT.has(task.status) ? task.attempt - 1 : task.attempt;
  return Array.from({ length: Math.max(0, finished) }, (_, i): Attempt => {
    const attempt = i + 1;
    const last = attempt === task.attempt;
    const started = Date.parse(task.created_at) + i * 120_000;
    const status = (last ? task.status : 'failed') as Attempt['status'];
    return {
      run_id: task.run_id,
      task_index: task.task_index,
      attempt,
      status,
      started_at: iso(started),
      finished_at: iso(started + 65_000),
      log_content: [
        `[task ${task.task_index}] attempt ${attempt} starting`,
        `[task ${task.task_index}] processed 1200 records`,
        status === 'succeeded'
          ? `[task ${task.task_index}] done`
          : `[task ${task.task_index}] upstream returned 503`,
      ].join('\n'),
      log_truncated: false,
      ...(status === 'succeeded'
        ? {}
        : {
            exit_code: status === 'failed' ? 1 : undefined,
            error_class: status,
            error_message: last ? task.error_message : 'process exited with status 1',
            outcome_code: 'upstream_unavailable',
            work_decision: {
              classification: 'retryable_failure',
              action: last ? 'fail_partition' : 'retry',
              reason: last ? 'retry_budget_exhausted' : 'unmatched_failure',
              policy_version: 1,
            },
          }),
    };
  });
}

/**
 * GET …/tasks/{idx}/logs/stream: the same SSE frames as an app's log
 * stream. A running task writes a line every 600 ms and stays open; a
 * queued one sends heartbeats; a finished one ends with `stored_output`.
 * `since_seq` is honoured as the inclusive first line.
 */
export function streamTaskLog(
  task: Task,
  query: URLSearchParams,
  req: IncomingMessage,
  res: ServerResponse
) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(':\n\n');
  const end = (reason: string) => {
    res.write(`event: end\ndata: ${JSON.stringify({ reason })}\n\n`);
    res.end();
  };
  if (!IN_FLIGHT.has(task.status)) {
    end('stored_output');
    return;
  }
  const instance = task.instance_id ?? '00000000-0000-4000-8000-000000000000';
  let seq = Math.max(1, Number(query.get('since_seq') ?? 0) || 1);
  const timer = setInterval(
    () => {
      if (task.status === 'queued') {
        res.write(':\n\n');
        return;
      }
      res.write(
        `event: log\ndata: ${JSON.stringify({
          seq,
          instance,
          stream: seq % 7 === 0 ? 'stderr' : 'stdout',
          line: `[task ${task.task_index}] batch ${seq}: processed ${seq * 100} records`,
          written_at: new Date().toISOString(),
        })}\n\n`
      );
      seq += 1;
    },
    task.status === 'queued' ? 15_000 : 600
  );
  req.on('close', () => clearInterval(timer));
}
