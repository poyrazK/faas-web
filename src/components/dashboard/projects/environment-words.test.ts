import { describe, expect, it } from 'vitest';
import type { EnvironmentDiff, EnvironmentState } from '@/lib/api/projects';
import {
  describeDifferences,
  environmentSummary,
  groupLabel,
  releaseWords,
} from './environment-words';

type Release = EnvironmentState['workloads'][number]['release'];
const release = (over: Partial<Release> = {}): Release => ({
  workload_slug: 'api',
  workload_name: 'api',
  status: 'live',
  ...over,
});
const routes = {
  ownership: 'application' as const,
  only_allow_declared_routes: false,
  declared_routes: [],
};
const policies = { ownership: 'application' as const, rules: [] };
const workload = (name: string, before: Release, after: Release) => ({
  workload_slug: name,
  workload_name: name,
  release: { kind: 'changed' as const, before, after },
  variables: [],
  secrets: [],
  bindings: [],
  domains: { kind: 'unchanged' as const, before: [], after: [] },
  routes: { kind: 'unchanged' as const, before: routes, after: routes },
  policies: { kind: 'unchanged' as const, before: policies, after: policies },
});

describe('environment words', () => {
  it('names two different live releases by their short ids', () => {
    const diff = {
      from_environment: 'staging',
      to_environment: 'production',
      configuration: { changes: [], from_version: 1, to_version: 1 },
      workloads: [
        workload(
          'api',
          release({ deployment_id: 'aaaaaaa1' }),
          release({ deployment_id: 'bbbbbbb2' })
        ),
      ],
    } as unknown as EnvironmentDiff;
    expect(describeDifferences(diff).groups[0].lines).toEqual([
      'Runs a different release (aaaaaaa in Staging, bbbbbbb in Production).',
    ]);
  });

  it('names a release by its short id, or says nothing is deployed', () => {
    expect(releaseWords(release({ deployment_id: '1d3ffd231382ce785dfbb0a4f466bf69' }))).toBe(
      'release 1d3ffd2'
    );
    expect(releaseWords(release({ status: 'not_deployed' }))).toBe('not deployed');
  });

  it('sums an environment up in one line', () => {
    const state = (statuses: Release['status'][]) =>
      ({ workloads: statuses.map((status) => ({ release: release({ status }) })) }) as never;
    expect(environmentSummary(state(['live', 'live', 'live']))).toBe('All 3 apps are live');
    expect(environmentSummary(state(['live', 'not_deployed']))).toBe('1 of 2 apps live');
    expect(environmentSummary(state(['not_deployed']))).toBe('Nothing deployed yet');
    expect(environmentSummary(state([]))).toBe('No apps yet');
  });

  it('groups apps with the same difference so it reads once', () => {
    const idle = release({ status: 'not_deployed' });
    const diff = {
      from_environment: 'staging',
      to_environment: 'production',
      configuration: { changes: [], from_version: 1, to_version: 1 },
      workloads: ['a', 'b', 'c'].map((name) =>
        workload(name, idle, release({ deployment_id: `${name}23456789` }))
      ),
    } as unknown as EnvironmentDiff;
    const words = describeDifferences(diff);
    // The same situation in every app reads once, without ids.
    expect(words.groups).toEqual([
      { apps: ['a', 'b', 'c'], lines: ['Live in Production; nothing deployed in Staging.'] },
    ]);
    expect(words.same).toBe('Variables, secrets, routes, headers and domains are the same.');
    expect(groupLabel(['a', 'b', 'c'], 3)).toBe('All 3 apps');
    expect(groupLabel(['a', 'b'], 3)).toBe('a and b');
  });
});
