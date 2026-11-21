import { expect, it } from 'vitest';
import type { Workflow } from '@/lib/mock-data';
import { projectSummary, statusWord, workloadNote } from './project-words';

const workload = (slug: string, over: Record<string, unknown> = {}) => ({
  slug,
  workload_name: slug,
  status: 'active',
  deployment_status: 'live',
  build_status: 'succeeded',
  ...over,
});
const none = new Map<string, Workflow>();

it('says what the project is and where it deploys from, and that all is live', () => {
  const summary = projectSummary({
    project: {
      workloads: [workload('api'), workload('worker')],
      repo_full_name: 'acme/shop',
      production_branch: 'main',
    },
    apps: none,
    deployments: [],
  });
  expect(summary.what).toBe('2 apps.');
  expect(summary.source).toBe('Pushes to main in acme/shop deploy them.');
  expect(summary.problems).toEqual([]);
  expect(summary.good).toBe('Every latest deploy is live.');
});

it('names failures and counts deploys in progress, and never calls that good', () => {
  const summary = projectSummary({
    project: {
      workloads: [
        workload('api', { build_status: 'failed', deployment_status: 'failed' }),
        workload('worker', { deployment_status: 'building' }),
        workload('cron', { deployment_status: 'failed' }),
      ],
      repo_full_name: undefined,
      production_branch: undefined,
    },
    apps: none,
    deployments: [],
  });
  expect(summary.source).toBe('Not connected to a repository.');
  expect(summary.problems).toEqual([
    { tone: 'critical', text: "api's latest build failed" },
    { tone: 'critical', text: "cron's latest deploy failed" },
  ]);
  // The deploy in progress is the third thing to say.
  expect(summary.extra).toBe(1);
  expect(summary.good).toBeNull();
});

it('claims nothing when a deployment status is missing', () => {
  const summary = projectSummary({
    project: {
      workloads: [workload('api', { deployment_status: undefined, build_status: undefined })],
      repo_full_name: 'acme/shop',
      production_branch: undefined,
    },
    apps: none,
    deployments: [],
  });
  expect(summary.what).toBe('1 app.');
  expect(summary.source).toBe('Connected to acme/shop.');
  expect(summary.problems).toEqual([]);
  expect(summary.good).toBeNull();
});

it('reports high error share from the app, beside a failed deploy', () => {
  const app = {
    id: 'api',
    name: 'api',
    state: 'running',
    invocations24h: 5000,
    errorRatePct: 25.6,
  } as Workflow;
  const summary = projectSummary({
    project: {
      workloads: [workload('api', { deployment_status: 'failed' })],
      repo_full_name: 'acme/shop',
      production_branch: 'main',
    },
    apps: new Map([['api', app]]),
    deployments: [],
  });
  expect(summary.problems).toEqual([
    { tone: 'critical', text: 'api is failing 25.6% of requests and its latest deploy failed' },
  ]);
});

it('takes the time of a deploy from the list only when the list agrees', () => {
  const building = [{ workflowId: 'api', state: 'building' as const, createdAt: 1000 }];
  expect(workloadNote(workload('api', { deployment_status: 'pending' }), building)).toEqual({
    tone: 'warning',
    text: 'deploying',
    at: 1000,
  });
  // The project says failed; a stale "building" row lends it no time.
  expect(workloadNote(workload('api', { deployment_status: 'failed' }), building)).toEqual({
    tone: 'critical',
    text: 'deploy failed',
    at: undefined,
  });
  expect(workloadNote(workload('api'), building)).toBeNull();
});

it('capitalises a status as the API said it', () => {
  expect(statusWord('parked')).toBe('Parked');
  expect(statusWord('not_deployed')).toBe('Not deployed');
  expect(statusWord(undefined)).toBe('');
});

it('marks a deploy in progress as a look, not a failure', () => {
  const summary = projectSummary({
    project: {
      workloads: [workload('api', { deployment_status: 'building' })],
      repo_full_name: 'acme/shop',
      production_branch: 'main',
    },
    apps: none,
    deployments: [],
  });
  expect(summary.problems).toEqual([{ tone: 'warning', text: '1 deploy is in progress' }]);
});
