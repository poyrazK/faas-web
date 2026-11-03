import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BindingMockProblem,
  admitRunStep,
  cancelGraphRun,
  completeGraphRun,
  completeRun,
  createRun,
  getGraphRun,
  goDuration,
  graphRunDiagnostics,
  listGraphRuns,
  listRuns,
  readReleasePolicy,
  recoveryRefused,
  releaseGate,
  resumeGraphRun,
  reviewRun,
  writeReleasePolicy,
} from './binding-verification';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    if (error instanceof BindingMockProblem) return error.code;
    throw error;
  }
  return 'ok';
};

describe('release policy routes (faas bindings/release_policy.go)', () => {
  const a = { id: 'app-policy', slug: 'policy-app' };

  it('defaults to off at revision 0 and writes with the read revision', () => {
    expect(readReleasePolicy(a, null)).toMatchObject({ mode: 'off', revision: 0 });
    const next = writeReleasePolicy(a, null, 'base', {
      mode: 'enforce',
      expected_revision: 0,
      max_verification_age: '90s',
    });
    expect(next).toMatchObject({ mode: 'enforce', revision: 1, max_verification_age: '1m30s' });
    expect(
      code(() => writeReleasePolicy(a, null, 'base', { mode: 'enforce', expected_revision: 0 }))
    ).toBe('bindings_release_policy_changed');
  });

  it('keeps queue requirements on their own route and refuses implicit removal', () => {
    expect(
      code(() =>
        writeReleasePolicy(a, null, 'base', {
          mode: 'enforce',
          expected_revision: 1,
          queue_requirements: { orders: 'consumer_readiness' },
        })
      )
    ).toBe('validation_failed');
    writeReleasePolicy(a, null, 'queues', {
      mode: 'enforce',
      expected_revision: 1,
      queue_requirements: { orders: 'consumer_readiness' },
    });
    expect(
      code(() => writeReleasePolicy(a, null, 'base', { mode: 'enforce', expected_revision: 2 }))
    ).toBe('validation_failed');
  });

  it('needs a reason to turn enforcement off', () => {
    expect(
      code(() => writeReleasePolicy(a, 'staging', 'base', { mode: 'off', expected_revision: 0 }))
    ).toBe('validation_failed');
  });

  it('prints Go durations', () => {
    expect([goDuration(600), goDuration(5), goDuration(3600)]).toEqual(['10m0s', '5s', '1h0m0s']);
  });
});

describe('verification runs (faas bindings/verification_runs.go)', () => {
  const a = { id: 'app-runs', slug: 'runs-app', live: '22222222-2222-4222-8222-222222222222' };

  it('refuses a review until the policy is enforced', () => {
    expect(code(() => reviewRun(a, a.live, {}))).toBe('binding_verification_run_changed');
  });

  it('walks review → create → admit → complete', async () => {
    writeReleasePolicy(a, null, 'queues', {
      mode: 'enforce',
      expected_revision: 0,
      queue_requirements: { orders: 'handler_completion' },
    });
    const review = reviewRun(a, a.live, {});
    expect(review.queue_publish_required).toBe(true);
    const id = '11111111-1111-4111-8111-111111111111';
    const base = {
      id,
      deployment_id: a.live,
      review_digest: review.review_digest,
      ttl_seconds: 600,
      object_storage_write: false,
    };
    expect(code(() => createRun(a, { ...base, queue_publish: false }))).toBe('validation_failed');
    const run = createRun(a, { ...base, queue_publish: true, max_concurrency: 1 });
    expect(run.status).toBe('pending');
    expect(listRuns(a, new URLSearchParams()).runs.map((r) => r.id)).toEqual([id]);

    const probe = run.steps.findIndex((s) => s.plan.action === 'probe');
    const canary = run.steps.findIndex((s) => s.plan.action === 'queue-canary');
    expect(code(() => completeRun(a, id))).toBe('binding_verification_run_changed');
    expect(admitRunStep(a, id, probe)).toMatchObject({ owned: true, resource_kind: 'task' });
    // max_concurrency 1: the unfinished probe holds the only slot.
    expect(code(() => admitRunStep(a, id, canary))).toBe('binding_verification_budget_full');
  });
});

describe('the release gate on a traffic increase (handlers_binding_promotion.go)', () => {
  const a = { id: 'app-gate', slug: 'gate-app', live: '33333333-3333-4333-8333-333333333333' };

  it('passes an unenforced scope and blocks an enforced one without fresh evidence', () => {
    expect(releaseGate(a, a.live, undefined)).toBeNull();
    expect(recoveryRefused(a, undefined)).toBe(false);
    writeReleasePolicy(a, null, 'queues', {
      mode: 'enforce',
      expected_revision: 0,
      queue_requirements: { orders: 'handler_completion' },
    });
    expect(recoveryRefused(a, 'default')).toBe(true);
    const report = releaseGate(a, a.live, 'default');
    expect(report).toMatchObject({ passed: false, deployment_id: a.live, scope: 'default' });
    expect(report?.blockers.map((b) => b.code)).toEqual([
      'verification_unknown',
      'queue_completion_unverified',
    ]);
    // Another scope's policy is its own.
    expect(releaseGate(a, a.live, 'canary')).toBeNull();
  });
});

describe('project graph runs (handlers_project_binding_verification_runs.go)', () => {
  const apps = [
    { id: 'graph-a', slug: 'graph-api', live: '44444444-4444-4444-8444-444444444444' },
    { id: 'graph-b', slug: 'graph-worker', live: '55555555-5555-4555-8555-555555555555' },
  ];
  const at = (project = 'acme-shop') => [project, 'production', apps] as const;

  afterEach(() => vi.useRealTimers());

  it('seeds the acme-shop production graph and filters by effective status', () => {
    const all = listGraphRuns(...at(), new URLSearchParams());
    expect(all.runs.map((r) => r.status)).toEqual(['pending', 'expired', 'cancelled']);
    expect(listGraphRuns(...at(), new URLSearchParams('status=expired')).runs).toHaveLength(1);
    expect(listGraphRuns(...at('elsewhere'), new URLSearchParams()).runs).toEqual([]);
    expect(code(() => listGraphRuns(...at(), new URLSearchParams('include_members=true')))).toBe(
      'validation_failed'
    );
  });

  it('keeps graph members out of an app listing unless asked', () => {
    const graph = getGraphRun(...at(), listGraphRuns(...at(), new URLSearchParams()).runs[0].id);
    const member = graph.members['graph-api'];
    expect(member.graph_run_id).toBe(graph.id);
    const ids = (query: string) =>
      listRuns(apps[0], new URLSearchParams(query)).runs.map((r) => r.id);
    expect(ids('')).not.toContain(member.id);
    expect(ids('include_members=true')).toContain(member.id);
    expect(
      listRuns(apps[0], new URLSearchParams('include_members=true')).runs.find(
        (r) => r.id === member.id
      )
    ).toMatchObject({ graph_run_id: graph.id, project: 'acme-shop', environment: 'production' });
  });

  it('completes only once every member’s admitted steps succeeded, all at once', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const id = listGraphRuns(...at(), new URLSearchParams('status=pending')).runs[0].id;
    let graph = getGraphRun(...at(), id);
    expect(code(() => completeGraphRun(...at(), id))).toBe('binding_verification_run_changed');
    for (const [slug, member] of Object.entries(graph.members)) {
      const app = apps.find((a) => a.slug === slug)!;
      // A member completes through its graph, never alone.
      expect(code(() => completeRun(app, member.id))).toBe('binding_verification_run_changed');
      member.steps.forEach((step, index) => {
        if (step.plan.action === 'probe') admitRunStep(app, member.id, index);
      });
    }
    vi.setSystemTime(Date.now() + 5_000);
    graph = completeGraphRun(...at(), id);
    expect(graph.status).toBe('passed');
    expect(Object.values(graph.members).map((m) => m.status)).toEqual(['passed', 'passed']);
    expect(graphRunDiagnostics(...at(), id)).toMatchObject({ status: 'passed', recovery: [] });
  });

  it('cancels every member with the graph', () => {
    const id = listGraphRuns(...at(), new URLSearchParams()).runs[0].id;
    const graph = cancelGraphRun(...at(), id);
    expect(graph.status).toBe('cancelled');
    expect(Object.values(graph.members).every((m) => m.status === 'cancelled')).toBe(true);
    expect(code(() => resumeGraphRun(...at(), id))).toBe('binding_verification_run_changed');
  });
});
