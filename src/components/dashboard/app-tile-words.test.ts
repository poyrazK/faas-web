import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/lib/mock-data';
import { failingShare, latestDeployNote, projectsSummary, runtimeLabel } from './app-tile-words';

const app = (over: Partial<Workflow>): Workflow => ({
  id: 'api',
  name: 'api',
  runtime: 'node22',
  memoryMb: 512,
  state: 'running',
  url: '',
  invocations24h: 1000,
  avgDurationMs: 0,
  coldStartP50Ms: 0,
  errorRatePct: 0.4,
  lastDeployedAt: 1,
  version: 'abc1234',
  ...over,
});

describe('runtimeLabel', () => {
  it.each([
    ['node22', 'Node 22'],
    ['python313', 'Python 3.13'],
    ['go124', 'Go 1.24'],
    ['go124-alpine', 'Go 1.24 (Alpine)'],
    ['app', 'Container'],
    ['wasm-something', 'wasm-something'],
    [undefined, ''],
  ])('%s → %s', (raw, label) => expect(runtimeLabel(raw)).toBe(label));
});

describe('latestDeployNote', () => {
  const d = (
    workflowId: string,
    state: 'succeeded' | 'failed' | 'building',
    createdAt: number
  ) => ({
    workflowId,
    state,
    createdAt,
  });
  it('speaks only about the newest deploy, and only when it failed or is running', () => {
    expect(latestDeployNote('api', [d('api', 'failed', 1), d('api', 'succeeded', 2)])).toBeNull();
    expect(
      latestDeployNote('api', [d('api', 'succeeded', 1), d('api', 'failed', 2)])
    ).toMatchObject({
      tone: 'critical',
      text: 'deploy failed',
    });
    expect(latestDeployNote('api', [d('api', 'building', 3)])?.tone).toBe('warning');
    expect(latestDeployNote('api', [d('other', 'failed', 3)])).toBeNull();
  });
});

describe('failingShare', () => {
  it('names a high error share only when the figure is real', () => {
    expect(failingShare(app({ errorRatePct: 25.65 }))).toBe(25.65);
    expect(failingShare(app({ errorRatePct: 1 }))).toBeNull();
    expect(failingShare(app({ errorRatePct: 25, metricsUnavailable: true }))).toBeNull();
    expect(failingShare(app({ errorRatePct: 25, invocations24h: 0 }))).toBeNull();
  });
});

describe('projectsSummary', () => {
  it('says what there is, then the two most important problems', () => {
    const s = projectsSummary({
      apps: [
        app({ id: 'a', name: 'billing-recon', errorRatePct: 25.66 }),
        app({ id: 'b', name: 'image-resize' }),
        app({ id: 'c', name: 'search-indexer' }),
        app({ id: 'd', name: 'webhook-router' }),
      ],
      projectCount: 2,
      standaloneCount: 1,
      deployments: [
        { workflowId: 'a', state: 'failed', createdAt: 2 },
        { workflowId: 'b', state: 'failed', createdAt: 2 },
        { workflowId: 'c', state: 'building', createdAt: 2 },
      ],
    });
    expect(s.what).toBe('3 apps in 2 projects and 1 standalone.');
    // billing-recon has two problems and is named once.
    expect(s.problems).toEqual([
      'billing-recon is failing 25.7% of requests and its latest deploy failed',
      "image-resize's latest deploy failed",
    ]);
    expect(s.extra).toBe(1);
  });

  it('has no problems when everything is fine', () => {
    expect(
      projectsSummary({ apps: [app({})], projectCount: 0, standaloneCount: 1, deployments: [] })
    ).toEqual({ what: '1 app, none in a project yet.', problems: [], extra: 0 });
  });
});
