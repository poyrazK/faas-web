import type { components } from '../src/lib/api/schema';
import * as db from './data';

type Run = components['schemas']['MigrationVerification'];
type Request = components['schemas']['CreateMigrationVerificationRequest'];
type Route = (
  method: string,
  path: string,
  handler: (context: { params: Record<string, string>; body: Record<string, unknown> }) => unknown
) => void;

export function registerMigrationVerification(
  route: Route,
  Problem: new (status: number, code: string, detail?: string) => Error
) {
  const problem = (status: number, code: string, detail: string): never => {
    throw new Problem(status, code, detail);
  };
  const runs = new Map<string, Run>();
  const lastStep = new Map<string, number>();
  const refresh = (run: Run) => {
    // Simulate server work by elapsed time, independently of browser requests.
    const now = Date.now();
    let next = lastStep.get(run.id) ?? now;
    for (let count = 0; count < 20 && run.status === 'pending' && now - next >= 500; count++) {
      step(run);
      next += 500;
    }
    lastStep.set(run.id, next);
    if (
      (run.status === 'pending' || run.status === 'passed') &&
      run.request.checks.service_connections?.some(
        (connection) =>
          !db.deployments.some((d) => d.id === connection.deployment_id && d.status === 'live')
      )
    ) {
      run.status = 'blocked';
      run.reason = 'service_connection_target_changed';
    }
    return run;
  };
  const owned = (slug: string, id: string) => {
    const run = runs.get(id);
    return run?.app === slug ? refresh(run) : undefined;
  };
  route('GET', '/v1/apps/{slug}/migration-verifications', ({ params }) => ({
    runs: [...runs.values()]
      .filter((run) => run.app === params.slug)
      .map(refresh)
      .reverse()
      .slice(0, 20),
  }));
  route(
    'GET',
    '/v1/apps/{slug}/migration-verifications/{run}',
    ({ params }) =>
      owned(params.slug, params.run) ?? problem(404, 'not_found', 'No such verification.')
  );
  route('POST', '/v1/apps/{slug}/migration-verifications', ({ params, body }) => {
    const input = body as unknown as Request;
    const existing = owned(params.slug, input.id);
    if (existing) return existing;
    const app = db.apps.find((app) => app.slug === params.slug);
    if (
      !app ||
      !db.deployments.some(
        (deployment) =>
          deployment.id === input.deployment_id &&
          deployment.app_id === app.id &&
          deployment.status === 'live'
      )
    )
      return problem(409, 'conflict', 'Choose the current live deployment.');
    if ([...runs.values()].some((run) => run.app === app.slug && run.status === 'pending'))
      return problem(409, 'conflict', 'Resume the existing run.');
    if (!input.smoke_path?.startsWith('/') || /[?#]/.test(input.smoke_path))
      return problem(422, 'validation_error', 'Choose a read-only path.');
    if (
      input.checks.service_connections?.some(
        (c) =>
          !db.deployments.some(
            (d) => d.id === c.deployment_id && d.status === 'live' && d.app_id !== app.id
          )
      )
    )
      return problem(409, 'conflict', 'Wait for the selected target deployments.');
    const run: Run = {
      id: input.id,
      app: app.slug,
      deployment_id: input.deployment_id,
      scope: 'default',
      configuration_revision: 'a'.repeat(64),
      status: 'pending',
      phase: 'dependencies',
      request: input,
      checks: [],
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    };
    runs.set(run.id, run);
    lastStep.set(run.id, Date.now());
    return run;
  });
  const step = (run: Run) => {
    if (run.status !== 'pending') return;
    if (run.cancel_requested_at) {
      if (run.phase !== 'restoring') {
        run.phase = 'restoring';
        if (run.wake_id) run.recovery_status = 'pending';
      } else {
        run.status = 'cancelled';
        run.phase = 'complete';
        run.reason = 'verification_cancelled';
        if (run.wake_id) run.recovery_status = 'restored';
        run.completed_at = new Date().toISOString();
      }
      return;
    }
    switch (run.phase) {
      case 'dependencies':
      case 'cold_dependencies': {
        const cold = run.phase === 'cold_dependencies';
        if (cold) run.cold_dependency_task_id = db.id();
        else run.dependency_task_id = db.id();
        const checks = run.request.checks;
        for (const [name, enabled] of [
          ['postgres', checks.postgres_env_key],
          ['object_storage', checks.object_storage_prefix],
          ['external_api', checks.http_env_key],
        ]) {
          if (enabled)
            run.checks.push({
              name: `${cold ? 'after_wake' : 'startup'}/${name}`,
              status: 'passed',
              detail: 'Selected dependency check succeeded.',
            });
        }
        for (const connection of checks.service_connections ?? []) {
          run.checks.push({
            name: `${cold ? 'after_wake' : 'startup'}/service/${connection.env_key}`,
            status: 'passed',
            detail: 'The configured private service connection reached its selected deployment.',
          });
        }
        run.phase = cold ? 'complete' : 'startup';
        break;
      }
      case 'startup':
      case 'cold_smoke': {
        run.checks.push({
          name: run.phase,
          status: 'passed',
          detail: 'Selected deployment returned a successful gateway response.',
        });
        run.phase =
          run.phase === 'cold_smoke'
            ? 'cold_dependencies'
            : run.request.cold_wake
              ? 'park'
              : 'complete';
        break;
      }
      case 'park':
        run.wake_id = db.id();
        run.phase = 'drain';
        break;
      case 'drain':
        run.drained_at = new Date().toISOString();
        run.phase = 'wake';
        break;
      case 'wake':
        run.phase = 'waking';
        break;
      case 'waking':
        run.instance_id = db.id();
        run.checks.push({
          name: 'cold_wake',
          status: 'passed',
          detail: 'Serving instances drained and the selected deployment resumed.',
        });
        run.phase = 'cold_smoke';
        break;
    }
    if (run.phase === 'complete') {
      run.status = 'passed';
      run.completed_at = new Date().toISOString();
    }
  };
  route('POST', '/v1/apps/{slug}/migration-verifications/{run}/advance', ({ params }) => {
    const run = owned(params.slug, params.run);
    if (!run) return problem(404, 'not_found', 'No such verification.');
    step(run);
    lastStep.set(run.id, Date.now());
    return run;
  });
  route('POST', '/v1/apps/{slug}/migration-verifications/{run}/cancel', ({ params }) => {
    const run = owned(params.slug, params.run);
    if (!run) return problem(404, 'not_found', 'No such verification.');
    if (run.status === 'pending') run.cancel_requested_at ??= new Date().toISOString();
    return run;
  });
  return owned;
}
