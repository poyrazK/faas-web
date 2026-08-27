import { describe, expect, it } from 'vitest';
import { slugIndex, toDeployment, toRunState, toWorkflow } from './adapters';
import type { App, AppsMetrics, Deployment as ApiDeployment } from './queries';

/**
 * The adapter is the seam between the REST shapes and the view models the
 * console renders, which makes it the one place a wrong assumption about the
 * API turns into a plausible-looking lie on screen. Worth covering directly.
 */

const app = (over: Partial<App> = {}): App =>
  ({
    id: '0123456789abcdef0123456789abcdef',
    slug: 'hello-world',
    type: 'function',
    runtime: 'node22',
    ram_mb: 256,
    max_concurrency: 2,
    concurrency_per_vm: 5,
    min_instances: 0,
    status: 'active',
    url: 'https://hello-world.example.com',
    manifest: {},
    autoscale_target_rps: 0,
    autoscale_target_cpu_pct: 0,
    ...over,
  }) as App;

const deployment = (over: Partial<ApiDeployment> = {}): ApiDeployment =>
  ({
    id: 'dep0123456789abcdef0123456789abc',
    app_id: '0123456789abcdef0123456789abcdef',
    image_digest: 'sha256:abcdef1234567890',
    kind: 'image',
    status: 'active',
    created_at: '2026-08-01T10:00:00Z',
    ...over,
  }) as ApiDeployment;

describe('toRunState', () => {
  it('reads active as running', () => {
    expect(toRunState('active')).toBe('running');
  });

  it('treats a parked app as idle, not as an error', () => {
    // Scale-to-zero is the resting state on this platform. Showing it red
    // would flag every healthy idle app as broken.
    expect(toRunState('parked')).toBe('idle');
    expect(toRunState('stopped')).toBe('idle');
  });

  it('maps the failure vocabulary onto error', () => {
    expect(toRunState('failed')).toBe('error');
    expect(toRunState('crashed')).toBe('error');
  });

  it('falls back to idle for an unknown or missing status', () => {
    // `status` is an open string upstream, so this has to have an answer.
    expect(toRunState('something-new')).toBe('idle');
    expect(toRunState(undefined)).toBe('idle');
  });
});

describe('toWorkflow', () => {
  it('keys the workflow by slug, because every /v1/apps route is', () => {
    expect(toWorkflow(app()).id).toBe('hello-world');
  });

  it('leaves region and project unset rather than inventing them', () => {
    // The API exposes neither. A dash is honest; a plausible region is not.
    const workflow = toWorkflow(app());
    expect(workflow.region).toBeUndefined();
    expect(workflow.projectId).toBeUndefined();
  });

  it('reads metrics for its own slug out of the rollup', () => {
    const metrics = {
      range: '24h',
      source: 'prometheus',
      as_of: '2026-08-01T10:00:00Z',
      apps: {
        'hello-world': { request_count: 4200, latency_p50_ms: 12.7, error_rate_pct: 1.234 },
        'other-app': { request_count: 9, latency_p50_ms: 900, error_rate_pct: 50 },
      },
    } as unknown as AppsMetrics;

    const workflow = toWorkflow(app(), metrics);

    expect(workflow.invocations24h).toBe(4200);
    expect(workflow.avgDurationMs).toBe(13);
    expect(workflow.errorRatePct).toBe(1.23);
  });

  it('reads zero when the metrics rollup is degraded or absent', () => {
    // A degraded Prometheus zeroes the response rather than partially filling
    // it, so zero is the correct reading — not a missing value.
    const workflow = toWorkflow(app(), undefined);
    expect(workflow.invocations24h).toBe(0);
    expect(workflow.errorRatePct).toBe(0);
  });

  it('takes version and deploy time from the deployment, not the app row', () => {
    // AppResponse defines neither field; the spec's example is misleading.
    const workflow = toWorkflow(app(), undefined, deployment());

    expect(workflow.version).toBe('abcdef1');
    expect(workflow.lastDeployedAt).toBe(Date.parse('2026-08-01T10:00:00Z'));
  });

  it('has no version when the app has never been deployed', () => {
    const workflow = toWorkflow(app());
    expect(workflow.version).toBe('');
    expect(workflow.lastDeployedAt).toBe(0);
    expect(workflow.state).toBe('undeployed');
  });

  it('keeps a live state once a deployment exists', () => {
    expect(toWorkflow(app(), undefined, deployment()).state).toBe('running');
  });

  it('falls back to the app type when there is no runtime', () => {
    expect(toWorkflow(app({ type: 'app', runtime: undefined })).runtime).toBe('app');
  });
});

describe('toDeployment', () => {
  it('resolves app_id to the slug the console routes by', () => {
    const index = slugIndex([app()]);
    expect(toDeployment(deployment(), index).workflowId).toBe('hello-world');
  });

  it('keeps the raw app id when the app is not in the list', () => {
    // Better a value that can be matched later than a silent empty string.
    const result = toDeployment(deployment({ app_id: 'unknown' }), new Map());
    expect(result.workflowId).toBe('unknown');
  });

  it('strips the algorithm prefix off the digest', () => {
    expect(toDeployment(deployment(), new Map()).version).toBe('abcdef1');
  });

  it('surfaces the deploy error as the message when there is one', () => {
    const result = toDeployment(
      deployment({ status: 'failed', error: 'build exited 1' }),
      new Map()
    );

    expect(result.state).toBe('failed');
    expect(result.message).toBe('build exited 1');
  });

  it('preserves server metadata for the durable deployment detail view', () => {
    const result = toDeployment(
      deployment({
        status: 'failed',
        error: 'build exited 1',
        error_code: 'build_failed',
        build_id: 'build0123456789abcdef0123456789ab',
      }),
      new Map()
    );

    expect(result.status).toBe('failed');
    expect(result.error).toBe('build exited 1');
    expect(result.errorCode).toBe('build_failed');
    expect(result.buildId).toBe('build0123456789abcdef0123456789ab');
  });

  it('treats an unrecognised status as still building', () => {
    expect(toDeployment(deployment({ status: 'queued' }), new Map()).state).toBe('building');
  });
});
