import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const deployment = vi.hoisted(() => ({ value: undefined as Record<string, unknown> | undefined }));
const latest = vi.hoisted(() => ({
  value: [] as { id: string; status: string; created_at?: string }[],
}));
const readError = vi.hoisted(() => ({ value: null as Error | null }));
vi.mock('@/lib/api/queries', () => ({
  useDeployment: () => ({ data: deployment.value, error: readError.value }),
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

  it('says the status is unavailable when the deployment cannot be read', async () => {
    deployment.value = undefined;
    readError.value = new Error('Not found');
    const onChange = vi.fn();
    render(
      <LaunchTracker
        seed={{ slug: 'api', source: 'git', deploymentId: 'd1' }}
        onChange={onChange}
      />
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ stage: 'unavailable', failure: 'Not found' })
      )
    );
    readError.value = null;
  });

  it('follows a newer deployment that overtook a failed one', async () => {
    deployment.value = { id: 'd1', status: 'failed', created_at: '2026-10-11T10:00:00Z' };
    latest.value = [{ id: 'd2', status: 'building', created_at: '2026-10-11T10:05:00Z' }];
    const onChange = vi.fn();
    render(
      <LaunchTracker
        seed={{ slug: 'api', source: 'git', deploymentId: 'd1' }}
        onChange={onChange}
      />
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ deploymentId: 'd2', stage: 'building', failure: undefined })
      )
    );
    latest.value = [];
  });

  it('keeps its own deployment when the latest one is older', async () => {
    deployment.value = { id: 'd2', status: 'failed', created_at: '2026-10-11T10:05:00Z' };
    latest.value = [{ id: 'd1', status: 'failed', created_at: '2026-10-11T10:00:00Z' }];
    const onChange = vi.fn();
    render(
      <LaunchTracker
        seed={{ slug: 'api', source: 'git', deploymentId: 'd2' }}
        onChange={onChange}
      />
    );
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ deploymentId: 'd2', stage: 'failed' })
      )
    );
    latest.value = [];
  });
});
