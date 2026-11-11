import { describe, expect, it } from 'vitest';
import type { App } from '@/lib/api/queries';
import type { GitHubConnection } from '@/lib/api/github-connection';
import {
  RELEASE_POLICIES,
  durationWords,
  generalSummary,
  githubSummary,
  healthSummary,
  localDiskSentence,
  memoryWords,
  prewarmSentence,
  releasePolicy,
  runtimeSummary,
} from './app-settings-words';

const app = (over: Partial<App> = {}) =>
  ({
    id: 'app-1',
    slug: 'api-gateway',
    type: 'app',
    runtime: 'node24',
    url: 'https://api-gateway.gregale.app',
    ram_mb: 512,
    idle_timeout_s: 300,
    min_instances: 0,
    max_concurrency: 8,
    autoscale_target_rps: 50,
    ...over,
  }) as unknown as App;

describe('memoryWords and durationWords', () => {
  it('say sizes and times the way a person does, exactly', () => {
    expect(memoryWords(512)).toBe('512 MB');
    expect(memoryWords(2048)).toBe('2 GB');
    expect(memoryWords(1536)).toBe('1536 MB');
    expect(durationWords(1)).toBe('1 second');
    expect(durationWords(45)).toBe('45 seconds');
    expect(durationWords(60)).toBe('1 minute');
    expect(durationWords(300)).toBe('5 minutes');
    expect(durationWords(90)).toBe('1 minute 30 seconds');
    expect(durationWords(7200)).toBe('2 hours');
  });
});

describe('runtimeSummary', () => {
  it('says memory, sleeping and that nothing stays running', () => {
    expect(runtimeSummary(app()).sentence).toBe(
      'api-gateway uses 512 MB, sleeps after 5 minutes idle, and keeps no copies running while it is quiet.'
    );
  });

  it('says what always runs when the minimum is above zero', () => {
    expect(runtimeSummary(app({ min_instances: 2, idle_timeout_s: 60 })).sentence).toBe(
      'api-gateway uses 512 MB, always keeps 2 copies running, and lets extra copies sleep after 1 minute idle.'
    );
  });

  it('says less, never a guess, when the idle timeout is not reported', () => {
    expect(runtimeSummary(app({ idle_timeout_s: undefined })).sentence).toBe(
      'api-gateway uses 512 MB and sleeps when idle.'
    );
  });

  it('lists the warm pool, access gates and maintenance as facts', () => {
    const summary = runtimeSummary(
      app({
        warm_pool_size: 1,
        require_authn: true,
        maintenance_mode: true,
        public_auth: { mode: 'basic' },
      } as Partial<App>)
    );
    expect(summary.tone).toBe('warning');
    expect(summary.facts).toEqual([
      'Maintenance mode is on: every request gets a 503 until it is turned off',
      'Up to 8 copies at once',
      '1 copy kept paused and ready to wake',
      'The public URL needs a username and password',
      'Requests need an API key',
    ]);
  });
});

describe('release policies', () => {
  it('name each preset plainly and keep the exact behaviour', () => {
    expect(RELEASE_POLICIES.map((p) => [p.value, p.label, Boolean(p.recommended)])).toEqual([
      ['safe', 'Careful', true],
      ['fast', 'Quick', false],
      ['immediate', 'All at once', false],
    ]);
    expect(releasePolicy('safe').detail).toMatch(/1%, 10%, 50%, then 100%/);
    expect(releasePolicy('immediate').line).toMatch(/straight away/);
  });

  it('describe how a new version goes live, reading unset as safe', () => {
    expect(healthSummary(app({ release_policy: undefined }), 'request').sentence).toBe(
      'New versions of api-gateway are tried on a few requests first and roll back on their own if server errors rise.'
    );
    expect(healthSummary(app({ release_policy: 'immediate' }), 'request').sentence).toBe(
      'New versions of api-gateway take all traffic at once, with no automatic rollback.'
    );
    expect(healthSummary(app(), 'request').facts).toEqual([
      'Restarted when it exits with an error (the default)',
    ]);
  });

  it('say when the default rollout does not apply, and a stored restart policy', () => {
    const worker = app({
      manifest: { execution_mode: 'worker', restart_policy: 'unless-stopped' },
    } as Partial<App>);
    expect(healthSummary(worker, 'worker').facts).toEqual([
      'It runs in worker mode, so the default rollout does not apply',
      'Restarted when it exits, unless it was stopped on purpose',
    ]);
  });
});

describe('generalSummary', () => {
  it('names what the app is and where it answers', () => {
    expect(generalSummary(app())).toEqual({
      before: 'api-gateway is a container app, public at',
      host: 'api-gateway.gregale.app',
      href: 'https://api-gateway.gregale.app/',
    });
    expect(generalSummary(app({ visibility: 'internal' })).before).toBe(
      'api-gateway is a container app, reachable only from other apps, not from a public URL.'
    );
    expect(generalSummary(app({ url: '' })).before).toBe(
      'api-gateway is a container app, with no public address assigned yet.'
    );
    expect(generalSummary(app({ type: 'function', runtime: 'python313' })).before).toBe(
      'api-gateway is a Python 3.13 function, public at'
    );
  });
});

describe('githubSummary', () => {
  const bound = {
    state: 'bound',
    health: 'healthy',
    connected: true,
    repo_full_name: 'acme/shop',
    production_branch: 'main',
    last_reconcile_repository_count: 1,
    last_reconcile_detached_count: 0,
  } as GitHubConnection;

  it('says which pushes deploy the app', () => {
    expect(githubSummary(bound, 'shop', 0)).toEqual({
      sentence: 'Pushes to main on acme/shop deploy shop.',
      facts: [],
      tone: 'good',
    });
    expect(githubSummary({ ...bound, production_branch: undefined }, 'shop', 0).sentence).toBe(
      'Pushes to the production branch of acme/shop deploy shop.'
    );
  });

  it('flags a degraded connection and failed activity', () => {
    const summary = githubSummary({ ...bound, health: 'degraded' }, 'shop', 2);
    expect(summary.tone).toBe('warning');
    expect(summary.facts).toEqual([
      'The connection needs attention',
      '2 recent GitHub updates failed',
    ]);
  });

  it('says pushes do not deploy without an installation or a binding', () => {
    expect(githubSummary({ ...bound, state: 'not_installed' }, 'shop', 0).sentence).toMatch(
      /GitHub isn’t connected/
    );
    expect(githubSummary({ ...bound, state: 'installed' }, 'shop', 0).sentence).toMatch(
      /isn’t linked to a repository/
    );
  });
});

describe('prewarm and local disk sentences', () => {
  it('count what is running and scheduled', () => {
    expect(prewarmSentence([])).toBe('No warm-ups are coming up.');
    expect(prewarmSentence(['pending'])).toBe('1 warm-up is scheduled.');
    expect(prewarmSentence(['running', 'pending', 'pending'])).toBe(
      '1 warm-up is running now and 2 warm-ups are scheduled.'
    );
  });

  it('count folders written, without claiming the app is stateless', () => {
    expect(localDiskSentence(0)).toMatch(/nothing has been seen/i);
    expect(localDiskSentence(1)).toMatch(/^1 folder on local disk was written to/);
  });
});
