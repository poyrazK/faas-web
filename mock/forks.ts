import { randomBytes, randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import { apps, deployments, EMPTY, iso, NOW } from './data';

/**
 * Dev-mock answers for production forks and crash snapshots (faas ADR-732,
 * ADR-733; docs/forks.md, docs/crash-snapshots.md), with the rules the console
 * explains:
 *
 * - forks walk queued → restoring → running from their age, and end as
 *   expired at `expires_at` or cancelled once asked; one active per app and two
 *   per account (409 `app_fork_limit`), Pro and Scale only (402
 *   `plan_app_forks_not_allowed`), the access token returned once;
 * - a live fork records a `live_fork` capture, refused within a minute of the
 *   last capture (409 `live_fork_refused`);
 * - a command walks queued → running → succeeded; one at a time, four pending
 *   (409 `app_fork_exec_refused`), only in a running fork;
 * - crash snapshots walk requested → capturing → ready, a manual one is refused
 *   within 10 minutes of the last (409 `crash_capture_refused`), and only a
 *   ready one opens as a fork (409 `crash_capture_not_ready`).
 *
 * `MOCK_HIDDEN_CAPABILITIES=production-forks,crash-snapshots` answers each
 * family 404, as apid's capability gate does. The first app has crash
 * snapshots and an ended fork; the second has a running fork with a command.
 */

type S = components['schemas'];
type Fork = S['AppForkResponse'] & { live?: boolean; finishAt?: number };
type Exec = S['AppForkExecResponse'];
type Capture = S['CrashCaptureResponse'];
interface MockCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
}
type Register = (method: string, template: string, handler: (ctx: MockCtx) => unknown) => void;
type ProblemCtor = new (
  status: number,
  code: string,
  detail?: string,
  extra?: Record<string, unknown>
) => Error;
export interface ForkMockOptions {
  hidden: (capability: string) => boolean;
  plan: () => string;
}

const S_ = 1000;
const MIN = 60 * S_;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const RESTORE = { queued: 1.5 * S_, restoring: 4 * S_, live: 3 * S_ } as const;
const CAPTURE = { requested: 1 * S_, capturing: 4 * S_ } as const;
const EXEC = { queued: 1 * S_, running: 2.5 * S_ } as const;
const status = (code: number, body: unknown) => ({ __status: code, body });
const at = (ms: number) => new Date(ms).toISOString();

export function registerForkMocks(
  route: Register,
  Problem: ProblemCtor,
  noContent: symbol,
  options: ForkMockOptions
) {
  void noContent;
  const forks = new Map<string, Fork[]>(apps.map((a) => [a.slug, []]));
  const execs = new Map<string, Exec[]>();
  const captures = new Map<string, Capture[]>(apps.map((a) => [a.slug, []]));
  const settings = new Map<string, S['CrashSnapshotSettingsResponse']>();

  const appOf = (slug: string) => {
    const app = apps.find((a) => a.slug === slug);
    if (!app) throw new Problem(404, 'not_found', 'no such app');
    return app;
  };
  const liveDeployment = (appId: string) =>
    deployments.find((d) => d.app_id === appId && d.status === 'live') ??
    deployments.find((d) => d.app_id === appId);
  const gate = (capability: string) => {
    if (options.hidden(capability)) throw new Problem(404, 'not_found', 'no such API route');
    const plan = options.plan();
    if (plan !== 'pro' && plan !== 'scale')
      throw new Problem(
        402,
        'plan_app_forks_not_allowed',
        `the ${plan} plan does not include production forks; upgrade to Pro or above.`
      );
  };

  /** The status a fork's age implies, written onto the row so every read agrees. */
  const advanceFork = (fork: Fork, now = Date.now()) => {
    if (fork.status === 'failed' || fork.status === 'expired' || fork.status === 'cancelled')
      return fork;
    const age = now - Date.parse(fork.created_at);
    const restoring = fork.live ? RESTORE.live : RESTORE.queued;
    if (fork.cancel_requested_at) {
      const asked = Date.parse(fork.cancel_requested_at);
      // A queued fork ends at once; a restoring or running one a moment later.
      if (fork.status === 'queued' || now - asked > 2 * S_) {
        fork.finished_at = at(fork.status === 'queued' ? asked : asked + 2 * S_);
        fork.status = 'cancelled';
        fork.updated_at = fork.finished_at;
        return fork;
      }
    }
    if (now >= Date.parse(fork.expires_at)) {
      fork.status = 'expired';
      fork.finished_at = fork.expires_at;
    } else if (age >= restoring + RESTORE.restoring) {
      fork.status = 'running';
      fork.started_at ??= at(Date.parse(fork.created_at) + restoring + RESTORE.restoring);
    } else if (age >= restoring) fork.status = 'restoring';
    fork.updated_at = at(now);
    return fork;
  };
  const advanceExec = (exec: Exec, now = Date.now()) => {
    if (exec.status !== 'queued' && exec.status !== 'running') return exec;
    const age = now - Date.parse(exec.created_at);
    if (age >= EXEC.running) {
      const fail = /\bfalse\b/.test(exec.command.join(' '));
      exec.status = fail ? 'failed' : 'succeeded';
      exec.exit_code = fail ? 1 : 0;
      exec.started_at ??= at(Date.parse(exec.created_at) + EXEC.queued);
      exec.finished_at = at(Date.parse(exec.created_at) + EXEC.running);
      exec.stdout = fail ? '' : `mock fork output for: ${exec.command.join(' ')}\n`;
      exec.stderr = fail ? 'mock: command exited 1\n' : '';
    } else if (age >= EXEC.queued) {
      exec.status = 'running';
      exec.started_at ??= at(Date.parse(exec.created_at) + EXEC.queued);
    }
    return exec;
  };
  const advanceCapture = (capture: Capture, now = Date.now()) => {
    if (capture.status === 'failed') return capture;
    if (capture.expires_at && now >= Date.parse(capture.expires_at)) {
      capture.status = 'expired';
      return capture;
    }
    if (capture.status === 'ready' || capture.status === 'expired') return capture;
    const age = now - Date.parse(capture.requested_at);
    if (age >= CAPTURE.capturing) {
      capture.status = 'ready';
      const captured = Date.parse(capture.requested_at) + CAPTURE.capturing;
      capture.captured_at = at(captured);
      capture.expires_at = at(captured + (capture.trigger === 'live_fork' ? 4 * HOUR : 7 * DAY));
    } else if (age >= CAPTURE.requested) capture.status = 'capturing';
    return capture;
  };

  const forksOf = (slug: string) => {
    appOf(slug);
    const list = forks.get(slug)!;
    for (const fork of list) advanceFork(fork);
    return list;
  };
  const findFork = (slug: string, id: string) => {
    const fork = forksOf(slug).find((f) => f.id === id);
    if (!fork) throw new Problem(404, 'not_found', 'no such fork');
    return fork;
  };
  const capturesOf = (slug: string) => {
    appOf(slug);
    const list = captures.get(slug)!;
    for (const capture of list) advanceCapture(capture);
    return list;
  };
  const findCapture = (slug: string, id: string) => {
    const capture = capturesOf(slug).find((c) => c.id === id);
    if (!capture) throw new Problem(404, 'not_found', 'no such crash snapshot');
    return capture;
  };
  const view = (fork: Fork): S['AppForkResponse'] => {
    const { live: _live, finishAt: _finishAt, ...rest } = fork;
    void _live;
    void _finishAt;
    return rest;
  };
  const active = (fork: Fork) =>
    fork.status === 'queued' || fork.status === 'restoring' || fork.status === 'running';

  const ttlOf = (body: Record<string, unknown>) => {
    if (body.ttl_seconds === undefined) return 3600;
    const ttl = Number(body.ttl_seconds);
    if (!Number.isInteger(ttl) || ttl < 60 || ttl > 14400)
      throw new Problem(400, 'validation_failed', 'ttl_seconds must be between 60 and 14400', {
        limit: 14400,
        observed: ttl,
      });
    return ttl;
  };

  const admit = (slug: string, body: Record<string, unknown>, captureId?: string) => {
    const app = appOf(slug);
    const ttl = ttlOf(body);
    const live = body.live === true;
    if (live && captureId)
      throw new Problem(400, 'validation_failed', 'a crash snapshot fork cannot also be live');
    const mine = forksOf(slug).filter(active).length;
    if (mine >= 1)
      throw new Problem(
        409,
        'app_fork_limit',
        `this app already has ${mine} active fork(s); the limit is 1. Delete a fork or wait for it to expire.`,
        { limit: 1, observed: mine }
      );
    const all = apps.reduce((n, a) => n + forksOf(a.slug).filter(active).length, 0);
    if (all >= 2)
      throw new Problem(
        409,
        'app_fork_limit',
        `this account already has ${all} active fork(s); the limit is 2. Delete a fork or wait for it to expire.`,
        { limit: 2, observed: all }
      );
    const deployment = liveDeployment(app.id);
    if (!deployment)
      throw new Problem(
        409,
        'app_fork_unavailable',
        'the app has no live deployment to fork; deploy it first.'
      );
    let capture = captureId;
    if (live) {
      const recent = capturesOf(slug).some(
        (c) => Date.now() - Date.parse(c.requested_at) < MIN || c.status === 'capturing'
      );
      if (recent)
        throw new Problem(
          409,
          'live_fork_refused',
          'the app has no running instance to capture, a capture is already running, or one was taken in the last minute'
        );
      const taken = newCapture(app.id, deployment.id, 'live_fork', app.ram_mb);
      captures.get(slug)!.unshift(taken);
      capture = taken.id;
    }
    const now = Date.now();
    const fork: Fork = {
      id: randomUUID(),
      app_id: app.id,
      deployment_id: deployment.id,
      ...(capture ? { crash_capture_id: capture } : {}),
      status: 'queued',
      ttl_seconds: ttl,
      expires_at: at(now + ttl * S_),
      created_at: at(now),
      updated_at: at(now),
      live,
    };
    forks.get(slug)!.unshift(fork);
    const token = `gfk_${randomBytes(32).toString('base64url')}`;
    return status(202, { ...view(fork), access_token: token });
  };

  const newCapture = (
    appId: string,
    deploymentId: string,
    trigger: Capture['trigger'],
    ramMb: number
  ): Capture => ({
    id: randomUUID(),
    app_id: appId,
    deployment_id: deploymentId,
    trigger,
    status: 'requested',
    mem_bytes: ramMb * 1024 * 1024,
    requested_at: at(Date.now()),
  });

  // Seeds: the first app has crash snapshots and two ended forks, the second
  // a running fork with one command.
  if (!EMPTY && apps.length > 1) {
    const [first, second] = apps;
    const dep1 = liveDeployment(first.id);
    const dep2 = liveDeployment(second.id);
    if (dep1) {
      const mem = first.ram_mb * 1024 * 1024;
      const ready = (msAgo: number, rest: Partial<Capture>): Capture => ({
        id: randomUUID(),
        app_id: first.id,
        deployment_id: dep1.id,
        trigger: 'http_5xx',
        status: 'ready',
        mem_bytes: mem,
        requested_at: iso(msAgo),
        captured_at: iso(msAgo - S_),
        expires_at: at(NOW - msAgo + 7 * DAY),
        ...rest,
      });
      const fromCode = ready(3 * HOUR, {
        trigger: 'sdk',
        reason: 'checkout failed',
        route: '/checkout',
      });
      captures.set(first.slug, [
        ready(40 * MIN, { status_code: 502, route: '/orders/{id}' }),
        fromCode,
        {
          id: randomUUID(),
          app_id: first.id,
          deployment_id: dep1.id,
          trigger: 'manual',
          status: 'failed',
          requested_at: iso(2 * DAY),
          failure: {
            code: 'instance_gone',
            message: 'the instance parked before the capture finished',
          },
        },
        ready(8 * DAY, { trigger: 'manual', status: 'expired', expires_at: iso(DAY) }),
      ]);
      settings.set(first.slug, { enabled: true, updated_at: iso(5 * DAY) });
      forks.set(first.slug, [
        {
          id: randomUUID(),
          app_id: first.id,
          deployment_id: dep1.id,
          crash_capture_id: fromCode.id,
          status: 'expired',
          ttl_seconds: 1800,
          created_at: iso(2 * HOUR),
          started_at: iso(2 * HOUR - 5 * S_),
          expires_at: iso(90 * MIN),
          finished_at: iso(90 * MIN),
          updated_at: iso(90 * MIN),
        },
        {
          id: randomUUID(),
          app_id: first.id,
          deployment_id: dep1.id,
          status: 'failed',
          ttl_seconds: 3600,
          created_at: iso(DAY),
          expires_at: iso(DAY - HOUR),
          finished_at: iso(DAY - 3 * S_),
          updated_at: iso(DAY - 3 * S_),
          failure: { code: 'no_capture', message: 'the deployment has no snapshot yet' },
        },
      ]);
    }
    if (dep2) {
      const running: Fork = {
        id: randomUUID(),
        app_id: second.id,
        deployment_id: dep2.id,
        status: 'running',
        ttl_seconds: 7200,
        created_at: iso(10 * MIN),
        started_at: iso(10 * MIN - 4 * S_),
        expires_at: at(NOW - 10 * MIN + 2 * HOUR),
        updated_at: iso(10 * MIN - 4 * S_),
      };
      forks.set(second.slug, [running]);
      execs.set(running.id, [
        {
          id: randomUUID(),
          fork_id: running.id,
          command: ['ls -la /tmp'],
          shell: true,
          timeout_seconds: 60,
          max_output_bytes: 65536,
          status: 'succeeded',
          exit_code: 0,
          output_truncated: false,
          stdout:
            'total 8\ndrwxrwxrwt 2 app app 4096 Nov  3 10:00 .\ndrwxr-xr-x 1 app app 4096 Nov  3 09:58 ..\n',
          stderr: '',
          requested_by: 'account:design@gregale.dev',
          created_at: iso(8 * MIN),
          started_at: iso(8 * MIN - S_),
          finished_at: iso(8 * MIN - 2 * S_),
        },
      ]);
    }
  }

  // --- Forks ---------------------------------------------------------------------

  route('GET', '/v1/apps/{slug}/forks', ({ params, query }) => {
    if (options.hidden('production-forks'))
      throw new Problem(404, 'not_found', 'no such API route');
    const limit = query.get('limit') ? Number(query.get('limit')) : 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Problem(400, 'validation_failed', 'limit must be between 1 and 100');
    return { items: forksOf(params.slug).slice(0, limit).map(view) };
  });

  route('POST', '/v1/apps/{slug}/forks', ({ params, body }) => {
    gate('production-forks');
    if (body.live === true && options.hidden('crash-snapshots'))
      throw new Problem(
        501,
        'live_forks_not_enabled',
        'live forks need instance captures, which are not enabled on this control-plane host; fork without live'
      );
    return admit(params.slug, body);
  });

  route('GET', '/v1/apps/{slug}/forks/{id}', ({ params }) => {
    if (options.hidden('production-forks'))
      throw new Problem(404, 'not_found', 'no such API route');
    return view(findFork(params.slug, params.id));
  });

  route('DELETE', '/v1/apps/{slug}/forks/{id}', ({ params }) => {
    if (options.hidden('production-forks'))
      throw new Problem(404, 'not_found', 'no such API route');
    const fork = findFork(params.slug, params.id);
    if (active(fork) && !fork.cancel_requested_at) {
      fork.cancel_requested_at = at(Date.now());
      advanceFork(fork);
    }
    return status(202, view(fork));
  });

  route('GET', '/v1/apps/{slug}/forks/{id}/execs', ({ params }) => {
    if (options.hidden('production-forks'))
      throw new Problem(404, 'not_found', 'no such API route');
    const fork = findFork(params.slug, params.id);
    return { items: (execs.get(fork.id) ?? []).map((e) => advanceExec(e)) };
  });

  route('POST', '/v1/apps/{slug}/forks/{id}/execs', ({ params, body }) => {
    if (options.hidden('production-forks'))
      throw new Problem(404, 'not_found', 'no such API route');
    const fork = findFork(params.slug, params.id);
    const command = Array.isArray(body.command) ? body.command.map(String) : [];
    const shell = body.shell === true;
    if (command.length === 0 || command.length > 64 || (shell && command.length !== 1))
      throw new Problem(
        400,
        'validation_failed',
        'command must be a non-empty argv; with shell, one string'
      );
    const timeout = body.timeout_seconds === undefined ? 60 : Number(body.timeout_seconds);
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 600)
      throw new Problem(400, 'validation_failed', 'timeout_seconds must be between 1 and 600');
    const list = execs.get(fork.id) ?? [];
    const pending = list
      .map((e) => advanceExec(e))
      .filter((e) => e.status === 'queued' || e.status === 'running');
    if (fork.status !== 'running' || pending.length >= 4)
      throw new Problem(
        409,
        'app_fork_exec_refused',
        'the fork is not running, or already has 4 commands pending'
      );
    const exec: Exec = {
      id: randomUUID(),
      fork_id: fork.id,
      command,
      shell,
      timeout_seconds: timeout,
      max_output_bytes: Number(body.max_output_bytes ?? 65536),
      status: 'queued',
      output_truncated: false,
      stdout: '',
      stderr: '',
      requested_by: 'account:design@gregale.dev',
      created_at: at(Date.now()),
    };
    execs.set(fork.id, [exec, ...list]);
    return status(202, exec);
  });

  route('GET', '/v1/apps/{slug}/forks/{id}/execs/{exec_id}', ({ params }) => {
    if (options.hidden('production-forks'))
      throw new Problem(404, 'not_found', 'no such API route');
    const fork = findFork(params.slug, params.id);
    const exec = (execs.get(fork.id) ?? []).find((e) => e.id === params.exec_id);
    if (!exec) throw new Problem(404, 'not_found', 'no such fork command');
    return advanceExec(exec);
  });

  // --- Crash snapshots -----------------------------------------------------------

  route('GET', '/v1/apps/{slug}/crash-snapshots/settings', ({ params }) => {
    gate('crash-snapshots');
    appOf(params.slug);
    return settings.get(params.slug) ?? { enabled: false };
  });

  route('PUT', '/v1/apps/{slug}/crash-snapshots/settings', ({ params, body }) => {
    gate('crash-snapshots');
    appOf(params.slug);
    if (typeof body.enabled !== 'boolean')
      throw new Problem(400, 'validation_failed', 'invalid crash snapshot settings body');
    const saved = { enabled: body.enabled, updated_at: at(Date.now()) };
    settings.set(params.slug, saved);
    return saved;
  });

  route('GET', '/v1/apps/{slug}/crash-snapshots', ({ params }) => {
    gate('crash-snapshots');
    return { items: capturesOf(params.slug) };
  });

  route('POST', '/v1/apps/{slug}/crash-snapshots', ({ params }) => {
    gate('crash-snapshots');
    const app = appOf(params.slug);
    const list = capturesOf(params.slug);
    const busy = list.some(
      (c) =>
        c.status === 'requested' ||
        c.status === 'capturing' ||
        Date.now() - Date.parse(c.requested_at) < 10 * MIN
    );
    const deployment = liveDeployment(app.id);
    if (busy || !deployment)
      throw new Problem(
        409,
        'crash_capture_refused',
        'a capture is already running, one was taken in the last 10 minutes, or the app has no running instance'
      );
    const capture = newCapture(app.id, deployment.id, 'manual', app.ram_mb);
    list.unshift(capture);
    return status(202, capture);
  });

  route('GET', '/v1/apps/{slug}/crash-snapshots/{id}', ({ params }) => {
    gate('crash-snapshots');
    return findCapture(params.slug, params.id);
  });

  route('POST', '/v1/apps/{slug}/crash-snapshots/{id}/fork', ({ params, body }) => {
    gate('crash-snapshots');
    if (options.hidden('production-forks'))
      throw new Problem(
        501,
        'app_forks_not_enabled',
        'production forks are not enabled on this control-plane host'
      );
    const capture = findCapture(params.slug, params.id);
    if (capture.status !== 'ready')
      throw new Problem(
        409,
        'crash_capture_not_ready',
        'only a ready, unexpired crash snapshot can be opened as a fork'
      );
    return admit(params.slug, body, capture.id);
  });
}
