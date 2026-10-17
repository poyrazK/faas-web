import { appUrlFor, deployments, scenarioOf, scenarios, setScenario, type Scenario } from './data';
import type { App, Build, Deployment, LogFrame } from './data';

/**
 * The lifecycle a deployment created through the mock walks, so the console's
 * "Your app is live" and failed-first-deploy states can be reached in dev.
 *
 * Nothing runs on a timer. A tracked deployment remembers when it was created
 * and which plan it follows; `advanceDeployments(now)` — called by the plugin
 * before every request — writes the status that much elapsed time implies onto
 * the shared fixture rows, so every read (the deployment, the lists, the app,
 * the build, its stages and its log) agrees without each route knowing about
 * time. Seeded deployments are never tracked, so their statuses stay as they
 * were seeded.
 *
 *   source (git ref, tarball, retry)
 *     0 – 1.5 s   pending        build queued
 *     1.5 – 6.5 s building       build running: download, dependencies, image
 *     6.5 – 8.5 s imaging        build succeeded; security scan
 *     8.5 – 10.5 s snapshotting  snapshot, readiness
 *     10.5 s →    live
 *   image (digest-pinned, no build — accepted straight into imaging)
 *     0 – 6.5 s imaging, → 9.5 s snapshotting, then live
 *   MOCK_BUILD_FAIL=1 (source only — an image deploy has no build stage)
 *     0 – 1.5 s pending, → 4.5 s building, then failed installing dependencies
 */

export type Stage =
  | 'source_download'
  | 'dependency_restore'
  | 'image_build'
  | 'security_scan'
  | 'snapshot_prepare'
  | 'readiness';

interface Step {
  stage: Stage;
  status: 'building' | 'imaging' | 'snapshotting';
  /** Elapsed ms since creation at which this step closes. */
  end: number;
}

export interface Plan {
  /** The status reported before the first step starts. */
  queued: 'pending' | 'imaging';
  steps: Step[];
  outcome: 'live' | 'failed';
  /** Elapsed ms at which the build reaches a terminal state; absent for image deploys. */
  buildEnd?: number;
}

/** How long a new deployment waits for a builder before anything starts. */
export const QUEUE_MS = 1_500;

const SOURCE_STEPS: Step[] = [
  { stage: 'source_download', status: 'building', end: 2_500 },
  { stage: 'dependency_restore', status: 'building', end: 4_100 },
  { stage: 'image_build', status: 'building', end: 6_500 },
  { stage: 'security_scan', status: 'imaging', end: 8_500 },
  { stage: 'snapshot_prepare', status: 'snapshotting', end: 10_000 },
  { stage: 'readiness', status: 'snapshotting', end: 10_500 },
];
const IMAGE_STEPS: Step[] = [
  { stage: 'security_scan', status: 'imaging', end: 6_500 },
  { stage: 'snapshot_prepare', status: 'snapshotting', end: 8_500 },
  { stage: 'readiness', status: 'snapshotting', end: 9_500 },
];
// A failing build dies installing dependencies — the most common real cause.
const FAILING_STEPS: Step[] = [
  SOURCE_STEPS[0],
  { stage: 'dependency_restore', status: 'building', end: 4_500 },
];

export function lifecyclePlan(kind: 'source' | 'image', fail = false): Plan {
  if (kind === 'image') return { queued: 'imaging', steps: IMAGE_STEPS, outcome: 'live' };
  if (fail) return { queued: 'pending', steps: FAILING_STEPS, outcome: 'failed', buildEnd: 4_500 };
  return { queued: 'pending', steps: SOURCE_STEPS, outcome: 'live', buildEnd: 6_500 };
}

/** Total time from creation to the terminal status. */
export const settleMs = (plan: Plan) => plan.steps[plan.steps.length - 1].end;

export interface Phase {
  status: 'pending' | 'building' | 'imaging' | 'snapshotting' | 'live' | 'failed';
  build?: Build['status'];
  /** Index of the step in progress; -1 before the first, `steps.length` once settled. */
  step: number;
}

export function phaseAt(plan: Plan, elapsed: number): Phase {
  const build: Build['status'] | undefined =
    plan.buildEnd === undefined
      ? undefined
      : elapsed < QUEUE_MS
        ? 'queued'
        : elapsed < plan.buildEnd
          ? 'running'
          : plan.outcome === 'failed'
            ? 'failed'
            : 'succeeded';
  if (elapsed < QUEUE_MS) return { status: plan.queued, build, step: -1 };
  const step = plan.steps.findIndex((s) => elapsed < s.end);
  if (step === -1) return { status: plan.outcome, build, step: plan.steps.length };
  return { status: plan.steps[step].status, build, step };
}

// --- Build output ---------------------------------------------------------------

interface Toolchain {
  label: string;
  install: string;
  installed: string;
  error: string;
}

function toolchain(runtime: string): Toolchain {
  if (runtime.startsWith('python'))
    return {
      label: 'Python',
      install: 'pip install -r requirements.txt',
      installed: 'Successfully installed 37 packages',
      error: 'ERROR: No matching distribution found for acme-config-loader==2.4.1',
    };
  if (runtime.startsWith('go'))
    return {
      label: 'Go',
      install: 'go mod download',
      installed: 'downloaded 41 modules',
      error:
        'go: github.com/acme-corp/config-loader@v2.4.1: reading github.com/acme-corp/config-loader/go.mod at revision v2.4.1: unknown revision v2.4.1',
    };
  return {
    label: 'Node.js',
    install: 'npm ci',
    installed: 'added 214 packages in 1.1s',
    error:
      'npm ERR! 404 Not Found - GET https://registry.npmjs.org/@acme%2fconfig-loader - Not found',
  };
}

type TimedFrame = { at: number; level: LogFrame['level']; msg: string };

function buildScript(rec: Tracked): TimedFrame[] {
  const tc = toolchain(String(rec.app.runtime ?? ''));
  const head: TimedFrame[] = [
    { at: 1_500, level: 'info', msg: `#1 resolving source for ${rec.source}` },
    { at: 1_900, level: 'info', msg: `#2 detected ${tc.label} (${rec.app.runtime}) from manifest` },
    { at: 2_500, level: 'info', msg: '#3 restoring dependency cache (miss)' },
    { at: 2_900, level: 'info', msg: `#4 ${tc.install}` },
  ];
  if (rec.plan.outcome === 'failed')
    return [
      ...head,
      { at: 3_900, level: 'error', msg: tc.error },
      {
        at: 4_300,
        level: 'error',
        msg: `#4 ERROR: process "${tc.install}" did not complete successfully: exit code: 1`,
      },
      { at: 4_500, level: 'error', msg: 'build failed' },
    ];
  return [
    ...head,
    { at: 4_000, level: 'info', msg: `#4 ${tc.installed}` },
    { at: 4_100, level: 'info', msg: '#5 running build' },
    { at: 5_300, level: 'info', msg: '#6 exporting layers' },
    { at: 6_200, level: 'info', msg: `#7 wrote ${rec.deployment.image_digest.slice(0, 19)}…` },
    { at: 6_500, level: 'info', msg: 'build succeeded' },
  ];
}

/** The build output written so far, and whether the build has finished. */
export function buildLogAt(rec: Tracked, now: number): { frames: LogFrame[]; done: boolean } {
  if (rec.plan.buildEnd === undefined) return { frames: [], done: true };
  const elapsed = now - rec.startedAt;
  const frames = buildScript(rec)
    .filter((f) => f.at <= elapsed)
    .map((f) => ({
      ts: new Date(rec.startedAt + f.at).toISOString(),
      level: f.level,
      instance_id: '',
      msg: f.msg,
    }));
  return { frames, done: elapsed >= rec.plan.buildEnd };
}

/** `GET /v1/deployments/{id}/stages` for a tracked deployment. */
export function stagesAt(rec: Tracked, now: number) {
  const elapsed = now - rec.startedAt;
  const { step } = phaseAt(rec.plan, elapsed);
  const startOf = (i: number) => (i === 0 ? QUEUE_MS : rec.plan.steps[i - 1].end);
  const iso = (offset: number) => new Date(rec.startedAt + offset).toISOString();
  const failedLast = rec.plan.outcome === 'failed' && step >= rec.plan.steps.length;
  const history = rec.plan.steps.slice(0, Math.max(0, step)).map((s, i, closed) => ({
    name: s.stage,
    started_at: iso(startOf(i)),
    ended_at: iso(s.end),
    duration_ms: s.end - startOf(i),
    status: failedLast && i === closed.length - 1 ? ('failed' as const) : ('completed' as const),
    ...(failedLast && i === closed.length - 1
      ? { reason: toolchain(String(rec.app.runtime)).error }
      : {}),
  }));
  if (step < 0 || step >= rec.plan.steps.length) return { history };
  return {
    current: rec.plan.steps[step].stage,
    current_started_at: iso(startOf(step)),
    history,
  };
}

// --- Tracking -----------------------------------------------------------------

export interface Tracked {
  deployment: Deployment;
  app: App;
  build?: Build;
  plan: Plan;
  startedAt: number;
  /** What the build log names as its source: `owner/repo@ref`, or the app. */
  source: string;
  /** The app's status before this deployment, restored if it fails. */
  /** The app's mock scenario and status before this deployment, restored on cancel. */
  scenarioBefore: Scenario;
  statusBefore: App['status'];
  /** Another release of this app was live when this one started. */
  servingBefore: boolean;
  /** The status this module last wrote; anything else means a route changed it. */
  written: string;
  settled: boolean;
}

const tracked = new Map<string, Tracked>();
/** The mock-created deployment currently live per app, so a newer one supersedes it. */
const liveByApp = new Map<string, Deployment>();

export function trackedDeployment(id: string): Tracked | undefined {
  return tracked.get(id);
}

/**
 * Put a freshly created deployment (and its build row, for source deploys) on
 * the lifecycle. Rewrites the rows to their t=0 state.
 */
export function startDeployment(opts: {
  deployment: Deployment;
  app: App;
  build?: Build;
  fail?: boolean;
  now: number;
  source?: string;
}): Tracked {
  const { deployment, app, build, now } = opts;
  const plan = lifecyclePlan(build ? 'source' : 'image', Boolean(opts.fail) && Boolean(build));
  deployment.status = plan.queued;
  deployment.created_at = new Date(now).toISOString();
  deployment.traffic_percent = 0;
  deployment.error = null;
  deployment.error_code = null;
  if (build) {
    build.status = 'queued';
    build.enqueued_at = deployment.created_at;
    delete build.started_at;
    delete build.finished_at;
    delete build.duration_seconds;
    delete build.failure_class;
  }
  const rec: Tracked = {
    deployment,
    app,
    build,
    plan,
    startedAt: now,
    source: opts.source ?? app.slug,
    scenarioBefore: scenarioOf(app),
    statusBefore: app.status,
    servingBefore: deployments.some(
      (d) => d.app_id === app.id && d.id !== deployment.id && d.status === 'live'
    ),
    written: plan.queued,
    settled: false,
  };
  tracked.set(deployment.id, rec);
  setScenario(app, 'deploying');
  return rec;
}

/** Write the status elapsed time implies onto every unsettled tracked deployment. */
export function advanceDeployments(now: number) {
  for (const rec of tracked.values()) {
    if (rec.settled) continue;
    // A route moved it (cancel, for one): the lifecycle no longer owns it.
    if (rec.deployment.status !== rec.written) {
      rec.settled = true;
      if (scenarioOf(rec.app) === 'deploying') restore(rec);
      continue;
    }
    apply(rec, phaseAt(rec.plan, now - rec.startedAt));
  }
}

function apply(rec: Tracked, phase: Phase) {
  const { deployment: d, app, build } = rec;
  d.status = phase.status;
  rec.written = phase.status;

  if (build && phase.build) {
    build.status = phase.build;
    if (phase.build !== 'queued') build.started_at = iso(rec.startedAt + QUEUE_MS);
    if (phase.build === 'succeeded' || phase.build === 'failed') {
      build.finished_at = iso(rec.startedAt + rec.plan.buildEnd!);
      build.duration_seconds = Math.round((rec.plan.buildEnd! - QUEUE_MS) / 1000);
    }
    if (phase.build === 'failed') build.failure_class = 'user_error';
  }

  if (phase.status === 'live') {
    rec.settled = true;
    d.traffic_percent = 100;
    const previous = liveByApp.get(app.id);
    if (previous && previous !== d && previous.status === 'live') {
      previous.status = 'superseded';
      previous.traffic_percent = 0;
    }
    liveByApp.set(app.id, d);
    setScenario(app, 'healthy');
    if (app.visibility !== 'internal' && !app.url) app.url = appUrlFor(app.slug);
  } else if (phase.status === 'failed') {
    rec.settled = true;
    const tc = toolchain(String(app.runtime ?? ''));
    const at = (offset: number) => iso(rec.startedAt + offset);
    Object.assign(d, {
      error: `dependency install failed: ${tc.install} exited with code 1`,
      error_code: 'dep_install_failed',
      error_hint: 'A dependency could not be installed. Check its name and version.',
      error_why: `${tc.install} could not resolve a dependency: ${tc.error}`,
      error_fix:
        'Publish the missing package or pin a version that exists, commit the lockfile, and deploy again.',
      error_relevant_logs: [
        { ts: at(3_900), level: 'error', source: 'build', message: tc.error },
        {
          ts: at(4_300),
          level: 'error',
          source: 'build',
          message: `process "${tc.install}" did not complete successfully: exit code: 1`,
        },
      ],
    } satisfies Partial<Deployment>);
    // A failed first deploy leaves the app in error; a failed redeploy leaves
    // the release that was already serving where it was.
    if (wasServing(rec)) restore(rec);
    else setScenario(app, 'failing');
  } else if (scenarioOf(app) !== 'deploying') {
    setScenario(app, 'deploying');
  }
}

const wasServing = (rec: Tracked) => rec.servingBefore;

function restore(rec: Tracked) {
  scenarios.set(rec.app.slug, rec.scenarioBefore);
  rec.app.status = rec.statusBefore;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Test seam: forget every tracked deployment. */
export function resetLifecycle() {
  tracked.clear();
  liveByApp.clear();
}
