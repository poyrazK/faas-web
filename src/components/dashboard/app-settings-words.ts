import type { App } from '@/lib/api/queries';
import type { GitHubConnection } from '@/lib/api/github-connection';
import { defaultRestartPolicy, type ExecutionMode } from '@/lib/health-probes';
import { publicAppUrl } from '@/lib/app-url';
import { runtimeLabel } from './app-tile-words';

/**
 * An app's Configure tabs in plain words (docs/console-plain-english.md):
 * one sentence per tab that says what is set now, the short names each
 * choice wears, and the exact term each one stands for, kept for a `title`
 * or a tip. Every sentence is built from fields the app read returns; a
 * field the API leaves out makes the sentence say less, never a guess.
 */

export type Tone = 'good' | 'warning' | 'critical' | 'neutral';

export interface Summary {
  /** One plain sentence: what is set now and whether anything needs doing. */
  sentence: string;
  /** Short facts after it, smaller. */
  facts: string[];
  tone: Tone;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const copies = (n: number) => plural(n, 'copy', 'copies');

/** 512 → "512 MB", 2048 → "2 GB". */
export function memoryWords(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

/** Seconds as a person says them, exactly: 300 → "5 minutes", 90 → "1 minute 30 seconds". */
export function durationWords(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return plural(seconds / 3600, 'hour', 'hours');
  if (seconds < 60) return plural(seconds, 'second', 'seconds');
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest
    ? `${plural(minutes, 'minute', 'minutes')} ${plural(rest, 'second', 'seconds')}`
    : plural(minutes, 'minute', 'minutes');
}

/** Who may open the public URL (`public_auth.mode`). */
export const PUBLIC_AUTH: Record<'open' | 'bearer' | 'basic', { label: string; fact: string }> = {
  open: { label: 'Anyone', fact: 'Anyone can open the public URL' },
  bearer: { label: 'Bearer token', fact: 'The public URL needs a bearer token' },
  basic: { label: 'Username and password', fact: 'The public URL needs a username and password' },
};

/** `eviction_priority`, in words. */
export const EVICTION: Record<'best_effort' | 'reserved', string> = {
  best_effort: 'Normal',
  reserved: 'Reserved',
};

/** The Runtime tab's sentence: memory, sleeping, and what stays running. */
export function runtimeSummary(app: App): Summary {
  const name = app.slug;
  const memory = memoryWords(app.ram_mb);
  const idle =
    typeof app.idle_timeout_s === 'number' && app.idle_timeout_s > 0
      ? durationWords(app.idle_timeout_s)
      : undefined;
  const always = app.min_instances ?? 0;

  let sentence: string;
  if (always > 0)
    sentence = idle
      ? `${name} uses ${memory}, always keeps ${copies(always)} running, and lets extra copies sleep after ${idle} idle.`
      : `${name} uses ${memory} and always keeps ${copies(always)} running.`;
  else
    sentence = idle
      ? `${name} uses ${memory}, sleeps after ${idle} idle, and keeps no copies running while it is quiet.`
      : `${name} uses ${memory} and sleeps when idle.`;

  const facts: string[] = [];
  if (app.maintenance_mode)
    facts.push('Maintenance mode is on: every request gets a 503 until it is turned off');
  if (app.max_concurrency) facts.push(`Up to ${copies(app.max_concurrency)} at once`);
  const pool = app.warm_pool_size ?? 0;
  if (pool > 0) facts.push(`${copies(pool)} kept paused and ready to wake`);
  const mode = app.public_auth?.mode as keyof typeof PUBLIC_AUTH | undefined;
  if (mode && mode !== 'open' && PUBLIC_AUTH[mode]) facts.push(PUBLIC_AUTH[mode].fact);
  if (app.require_authn) facts.push('Requests need an API key');

  return { sentence, facts, tone: app.maintenance_mode ? 'warning' : 'neutral' };
}

export type ReleasePolicy = 'safe' | 'fast' | 'immediate';

/** The three rollout presets: a plain name, one short line, and the exact preset. */
export const RELEASE_POLICIES: {
  value: ReleasePolicy;
  label: string;
  recommended?: boolean;
  line: string;
  /** The exact behaviour, from faas pkg/api/appmanifest.go:292 and docs/deploys.md. */
  detail: string;
}[] = [
  {
    value: 'safe',
    label: 'Careful',
    recommended: true,
    line: 'Tries the new version on a few requests first.',
    detail:
      'Canary at 1%, 10%, 50%, then 100%, advancing on clean results. A 5xx regression rolls back.',
  },
  {
    value: 'fast',
    label: 'Quick',
    line: 'Moves traffic over in three short steps.',
    detail: 'Canary at 5%, 50%, then 100%, a minute each, with the same automatic rollback.',
  },
  {
    value: 'immediate',
    label: 'All at once',
    line: 'Sends every request to the new version straight away.',
    detail: 'All traffic moves at once. No canary, no probes, and no stage for a release approval.',
  },
];

export const releasePolicy = (value: ReleasePolicy) =>
  RELEASE_POLICIES.find((p) => p.value === value) ?? RELEASE_POLICIES[0];

/** What happens when the main process exits, per `restart_policy`. */
export const RESTART_WORDS: Record<string, string> = {
  no: 'Not restarted when it exits',
  'on-failure': 'Restarted when it exits with an error',
  always: 'Always restarted when it exits',
  'unless-stopped': 'Restarted when it exits, unless it was stopped on purpose',
};

const NON_REQUEST = new Set(['service', 'worker', 'job']);

/** The Health and releases tab's sentence: how a new version goes live, and restarts. */
export function healthSummary(app: App, mode: ExecutionMode): Summary {
  const name = app.slug;
  // apid reports the effective policy; the unset value is safe.
  const policy = (app.release_policy ?? 'safe') as ReleasePolicy;
  const sentence =
    policy === 'immediate'
      ? `New versions of ${name} take all traffic at once, with no automatic rollback.`
      : policy === 'fast'
        ? `New versions of ${name} take traffic in three short steps and roll back on their own if server errors rise.`
        : `New versions of ${name} are tried on a few requests first and roll back on their own if server errors rise.`;
  const facts: string[] = [];
  const manifestMode = app.manifest?.execution_mode;
  if (manifestMode && NON_REQUEST.has(manifestMode))
    facts.push(`It runs in ${manifestMode} mode, so the default rollout does not apply`);
  const restart = app.manifest?.restart_policy || defaultRestartPolicy(mode);
  const words = RESTART_WORDS[restart];
  if (words) facts.push(`${words}${app.manifest?.restart_policy ? '' : ' (the default)'}`);
  return { sentence, facts, tone: 'neutral' };
}

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** The General tab's sentence: what the app is and where it answers. */
export function generalSummary(app: App): { before: string; host?: string; href?: string } {
  // Matches the header: an `app` is a container whatever its build detected;
  // a function wears its runtime in plain words ("a Python 3.13 function").
  const kind =
    app.type === 'app'
      ? 'container app'
      : app.runtime
        ? `${runtimeLabel(app.runtime)} ${app.type}`
        : app.type;
  const lead = `${app.slug} is ${article(kind)} ${kind}`;
  if (app.visibility === 'internal')
    return { before: `${lead}, reachable only from other apps, not from a public URL.` };
  const href = publicAppUrl(app.url);
  if (!href) return { before: `${lead}, with no public address assigned yet.` };
  return {
    before: `${lead}, public at`,
    host: href.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    href,
  };
}

/** The GitHub connection in one sentence. */
export function githubSummary(data: GitHubConnection, slug: string, failed: number): Summary {
  if (data.state === 'not_installed')
    return {
      sentence: `GitHub isn’t connected, so pushes don’t deploy ${slug}.`,
      facts: [],
      tone: 'neutral',
    };
  if (data.state === 'installed')
    return {
      sentence: `${slug} isn’t linked to a repository, so pushes don’t deploy it.`,
      facts: [],
      tone: 'neutral',
    };
  const repo = data.repo_full_name ?? 'its repository';
  const branch = data.production_branch || data.default_branch;
  const sentence = branch
    ? `Pushes to ${branch} on ${repo} deploy ${slug}.`
    : `Pushes to the production branch of ${repo} deploy ${slug}.`;
  const facts: string[] = [];
  if (data.health === 'degraded') facts.push('The connection needs attention');
  if (data.health === 'unknown') facts.push('Not synced with GitHub yet');
  if (failed > 0)
    facts.push(`${plural(failed, 'recent GitHub update', 'recent GitHub updates')} failed`);
  return {
    sentence,
    facts,
    tone: data.health === 'degraded' || failed > 0 ? 'warning' : 'good',
  };
}

/** Prewarm statuses, in words; the raw status stays in a `title`. */
export const PREWARM_STATUS: Record<string, string> = {
  pending: 'Scheduled',
  running: 'Warm now',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** The scheduled warm-ups in one sentence. */
export function prewarmSentence(statuses: string[]): string {
  const running = statuses.filter((s) => s === 'running').length;
  const pending = statuses.filter((s) => s === 'pending').length;
  if (!running && !pending) return 'No warm-ups are coming up.';
  const parts = [
    running ? `${plural(running, 'warm-up is', 'warm-ups are')} running now` : '',
    pending ? `${plural(pending, 'warm-up is', 'warm-ups are')} scheduled` : '',
  ].filter(Boolean);
  return `${parts.join(' and ')}.`.replace(/^./, (c) => c.toUpperCase());
}

/** Writes to watched local-disk folders, in one sentence. */
export function localDiskSentence(folders: number): string {
  return folders === 0
    ? 'Nothing has been seen writing to the watched folders on local disk.'
    : `${plural(folders, 'folder on local disk was', 'folders on local disk were')} written to. Files written there are gone after the app sleeps.`;
}
