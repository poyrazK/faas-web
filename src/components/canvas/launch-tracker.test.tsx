import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const deployment = vi.hoisted(() => ({ value: undefined as Record<string, unknown> | undefined }));
const latest = vi.hoisted(() => ({ value: [] as { id: string; status: string }[] }));
vi.mock('@/lib/api/queries', () => ({
  useDeployment: () => ({ data: deployment.value }),
  useAppDeployments: () => ({ data: { pages: [{ items: latest.value }] } }),
}));
vi.mock('@/lib/api/logs', () => ({
  useLogStream: () => ({
    lines: [{ id: '1', ts: 0, text: '→ npm ci  added 412 packages', raw: '' }],
  }),
}));
const { LaunchTracker } = await import('./launch-tracker');

describe('LaunchTracker', () => {
  it('turns a building deployment into a rail state with its latest log line', async () => {
    deployment.value = { id: 'd1', status: 'building' };
    const onChange = vi.fn();
    render(
      <LaunchTracker
        seed={{ slug: 'api', source: 'git', repo: 'acme/api', ref: 'main', deploymentId: 'd1' }}
        onChange={onChange}
      />
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          stage: 'building',
          step: 2,
          logLine: '→ npm ci  added 412 packages',
        })
      )
    );
  });

  it('carries the real failure cause', async () => {
    deployment.value = { id: 'd1', status: 'failed', error_why: "Cannot find module './db'" };
    const onChange = vi.fn();
    render(
      <LaunchTracker
        seed={{ slug: 'api', source: 'git', deploymentId: 'd1' }}
        onChange={onChange}
      />
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ stage: 'failed', failure: "Cannot find module './db'" })
      )
    );
  });

  it('a rejected submission is a failed launch, not a queued one', async () => {
    deployment.value = undefined;
    const onChange = vi.fn();
    render(
      <LaunchTracker
        seed={{
          slug: 'api',
          source: 'git',
          submitError: 'Connect GitHub before deploying from a repository.',
        }}
        onChange={onChange}
      />
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          stage: 'failed',
          failure: 'Build was not submitted: Connect GitHub before deploying from a repository.',
        })
      )
    );
  });

  it('recovers a launch from the latest deployment after reload', async () => {
    deployment.value = { id: 'd7', status: 'deploying' };
    latest.value = [{ id: 'd7', status: 'deploying' }];
    const onChange = vi.fn();
    render(<LaunchTracker seed={{ slug: 'api', source: 'cli' }} onChange={onChange} />);
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ deploymentId: 'd7', stage: 'deploying', step: 3 })
      )
    );
    latest.value = [];
  });
});
