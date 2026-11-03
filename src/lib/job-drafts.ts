import type { components } from '@/lib/api/schema';
import { ENV_KEY } from './env-transfer';

/**
 * Text-to-request parsing for the job forms: a run's inputs and environment,
 * and the failure rules a job or a run classifies results with. Each check is
 * the one apid applies (faas handlers_jobs.go createJobRun, updateJob;
 * pkg/workpolicy/scheduled_policy.go), so a refusal is caught beside the field
 * rather than after a confirm.
 */

export type FailureRules = components['schemas']['FailureRules'];
export type JobRunInput = components['schemas']['JobRunInput'];

/** `CreateJobRunRequest.inputs` is 1–5000, as is `tasks`. */
export const MAX_RUN_TASKS = 5000;
const bytes = (value: string) => new TextEncoder().encode(value).length;

/**
 * One `ID=REF` per line, as `gregale job run --input ID=REF` takes them; the
 * first `=` splits. Order is the task order. apid wants a nonempty, untrimmed
 * id of at most 128 bytes, a nonempty ref of at most 2048, and unique ids.
 */
export function parseRunInputs(text: string): { inputs?: JobRunInput[]; error?: string } {
  const inputs: JobRunInput[] = [];
  const seen = new Set<string>();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const at = line.indexOf('=');
    const id = at > 0 ? line.slice(0, at).trim() : '';
    const ref = at > 0 ? line.slice(at + 1).trim() : '';
    if (!id || !ref) return { error: `Line ${i + 1}: write each input as ID=REFERENCE.` };
    if (bytes(id) > 128) return { error: `Line ${i + 1}: an input ID is at most 128 bytes.` };
    if (bytes(ref) > 2048) return { error: `Line ${i + 1}: a reference is at most 2048 bytes.` };
    if (seen.has(id)) return { error: `Input ID ${id} appears twice; each must be unique.` };
    seen.add(id);
    inputs.push({ input_id: id, input_ref: ref });
  }
  if (inputs.length === 0) return { error: 'Add at least one input.' };
  if (inputs.length > MAX_RUN_TASKS)
    return { error: `A run takes at most ${MAX_RUN_TASKS.toLocaleString('en-US')} inputs.` };
  return { inputs };
}

/**
 * `KEY=VALUE` per line. Keys follow apid's env key rule (`^[A-Z][A-Z0-9_]*$`,
 * at most 128). A run's own variables cannot use `GREGALE_`, which is the
 * platform's identity prefix (handlers_jobs.go createJobRun).
 */
export function parseEnvLines(
  text: string,
  { reservePlatform = false }: { reservePlatform?: boolean } = {}
): { env?: Record<string, string>; error?: string } {
  const env: Record<string, string> = {};
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.replace(/\r$/, '');
    if (!line.trim()) continue;
    const at = line.indexOf('=');
    const key = at > 0 ? line.slice(0, at).trim() : '';
    if (!ENV_KEY.test(key) || key.length > 128)
      return {
        error: `Line ${i + 1}: write KEY=VALUE, with a key of capitals, digits and underscores that starts with a letter.`,
      };
    if (reservePlatform && key.startsWith('GREGALE_'))
      return { error: `Line ${i + 1}: GREGALE_ is reserved for the platform's own variables.` };
    if (key in env) return { error: `${key} appears twice.` };
    env[key] = line.slice(at + 1);
  }
  return { env };
}

export const envLinesFrom = (env: Record<string, string> | undefined) =>
  Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

/** An external input manifest: an account-readable object and its exact digest. */
export const isManifestUri = (value: string) => /^obj:\/\/[^/\s]+\/[^/\s]+\/\S+$/.test(value);
export const isManifestDigest = (value: string) => /^sha256:[0-9a-f]{64}$/.test(value);

type Action = FailureRules['unmatched_failure'];
export interface FailureRuleDraft {
  /** Exit codes apply to jobs and command crons; outcome codes are the app's own. */
  kind: 'exit' | 'outcome';
  /** Comma- or space-separated, as typed. */
  codes: string;
  action: Action;
}
export interface FailureRulesDraft {
  enabled: boolean;
  rules: FailureRuleDraft[];
  unmatched: Action;
  uncertain: FailureRules['uncertain_outcome'];
}

/**
 * Off until asked for. The defaults when switched on are the conservative
 * pair: an unmatched failure keeps its retries, and a lost completion
 * receipt is held rather than repeated, since retrying it may run the work
 * twice (docs/jobs.md).
 */
export const NO_FAILURE_RULES: FailureRulesDraft = {
  enabled: false,
  rules: [],
  unmatched: 'retry',
  uncertain: 'hold',
};

export const MAX_FAILURE_RULES = 64;
const OUTCOME_CODE = /^[a-z0-9_.-]{1,64}$/;

export function failureRulesDraftFrom(rules: FailureRules | undefined): FailureRulesDraft {
  if (!rules) return NO_FAILURE_RULES;
  return {
    enabled: true,
    rules: rules.rules.map((rule) =>
      rule.exit_codes?.length
        ? { kind: 'exit', codes: rule.exit_codes.join(', '), action: rule.action }
        : { kind: 'outcome', codes: (rule.outcome_codes ?? []).join(', '), action: rule.action }
    ),
    unmatched: rules.unmatched_failure,
    uncertain: rules.uncertain_outcome,
  };
}

const splitCodes = (codes: string) => codes.split(/[\s,]+/).filter(Boolean);

/** Per-rule complaints, by index; apid wants every code unique across rules. */
export function failureRulesErrors(draft: FailureRulesDraft): { rules?: (string | undefined)[] } {
  if (!draft.enabled) return {};
  const exits = new Set<number>();
  const outcomes = new Set<string>();
  const errors = draft.rules.map((rule) => {
    const codes = splitCodes(rule.codes);
    if (codes.length === 0) return 'Enter at least one code.';
    for (const code of codes) {
      if (rule.kind === 'exit') {
        const n = Number(code);
        if (!/^\d+$/.test(code) || n < 1 || n > 255)
          return 'Exit codes are whole numbers between 1 and 255.';
        if (exits.has(n)) return `Exit code ${n} is already matched by another rule.`;
        exits.add(n);
      } else {
        if (!OUTCOME_CODE.test(code))
          return 'Outcome codes are lowercase letters, digits, _, - or ., up to 64 characters.';
        if (outcomes.has(code)) return `Outcome code ${code} is already matched by another rule.`;
        outcomes.add(code);
      }
    }
    return undefined;
  });
  if (draft.rules.length > MAX_FAILURE_RULES)
    errors[MAX_FAILURE_RULES] = `Use at most ${MAX_FAILURE_RULES} rules.`;
  return errors.some(Boolean) ? { rules: errors } : {};
}

export function failureRulesFrom(draft: FailureRulesDraft): FailureRules | undefined {
  if (!draft.enabled) return undefined;
  return {
    version: 1,
    rules: draft.rules.map((rule) =>
      rule.kind === 'exit'
        ? { exit_codes: splitCodes(rule.codes).map(Number), action: rule.action }
        : { outcome_codes: splitCodes(rule.codes), action: rule.action }
    ),
    unmatched_failure: draft.unmatched,
    uncertain_outcome: draft.uncertain,
  };
}

/** One line per rule, for a definition or a confirm. */
export function describeFailureRules(rules: FailureRules): string[] {
  const action = (a: Action) => (a === 'retry' ? 'retry' : 'fail the partition');
  return [
    ...rules.rules.map((rule) =>
      rule.exit_codes?.length
        ? `Exit ${rule.exit_codes.join(', ')} → ${action(rule.action)}`
        : `Outcome ${(rule.outcome_codes ?? []).join(', ')} → ${action(rule.action)}`
    ),
    `Any other failure → ${action(rules.unmatched_failure)}`,
    rules.uncertain_outcome === 'hold'
      ? 'Lost completion receipt → hold for reconciliation'
      : 'Lost completion receipt → retry (may run twice)',
  ];
}
