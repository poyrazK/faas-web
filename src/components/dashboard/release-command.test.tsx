import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { AppTask } from '@/lib/api/release-command';
import type { Deployment } from '@/lib/api/queries';

const useReleaseTask = vi.fn();
vi.mock('@/lib/api/release-command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/release-command')>()),
  useReleaseTask: (...args: unknown[]) => useReleaseTask(...args) as unknown,
}));
const useReleaseDiff = vi.fn();
vi.mock('@/lib/api/deployment-detail', () => ({
  useReleaseDiff: (id: string) => useReleaseDiff(id) as unknown,
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapabilityStage: () => 'Beta' }));
const { ReleaseCommand } = await import('./release-command');

const deployment = (over: Partial<Deployment> = {}): Deployment => ({
  id: 'a'.repeat(32),
  app_id: 'b'.repeat(32),
  image_digest: 'sha256:abc',
  kind: 'github',
  status: 'live',
  created_at: '2026-10-15T10:00:00Z',
  revision: 42,
  ...over,
});
const task = (over: Partial<AppTask> = {}): AppTask => ({
  id: '0b8f3c1e-1111-4222-8333-444455556666',
  app_id: 'b'.repeat(32),
  deployment_id: 'a'.repeat(32),
  deployment_scope: 'default',
  kind: 'release',
  command: ['npm', 'run', 'migrate'],
  command_shell: false,
  status: 'succeeded',
  timeout_seconds: 900,
  max_output_bytes: 65536,
  attempt_count: 1,
  output_truncated: false,
  exit_code: 0,
  stdout_tail: 'Applied 3 migrations\n',
  created_at: '2026-10-15T10:00:00Z',
  updated_at: '2026-10-15T10:00:12Z',
  ...over,
});
const read = (data: unknown, extra: Record<string, unknown> = {}) => ({
  data,
  error: null,
  isPending: false,
  refetch: vi.fn(),
  ...extra,
});

beforeEach(() => {
  useReleaseTask.mockReset();
  useReleaseDiff.mockReset();
  useReleaseDiff.mockReturnValue(read(undefined, { isPending: true }));
  useReleaseTask.mockReturnValue(read({ task: task(), searched: 3, complete: true }));
});

describe('ReleaseCommand', () => {
  it('renders nothing for a deployment that declares no release command', () => {
    const { container } = render(<ReleaseCommand slug="api" deployment={deployment()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a succeeded run: status, command, timing, databases, output and the CLI', () => {
    render(
      <ReleaseCommand
        slug="api"
        deployment={deployment({
          release: {
            status: 'succeeded',
            started_at: '2026-10-15T10:00:00Z',
            finished_at: '2026-10-15T10:00:12Z',
            migration_databases: [{ id: 'db-1', name: 'orders' }],
          },
        })}
      />
    );
    const panel = screen.getByRole('region', { name: 'Release command' });
    expect(panel).toHaveTextContent('Beta');
    expect(panel).toHaveTextContent('Succeeded');
    expect(panel).toHaveTextContent('npm run migrate');
    expect(panel).toHaveTextContent('12 s');
    expect(panel).toHaveTextContent('orders');
    expect(panel).toHaveTextContent('Applied 3 migrations');
    expect(panel).toHaveTextContent('gregale release summary v42 --app api');
    expect(useReleaseTask).toHaveBeenCalledWith('api', 'a'.repeat(32), {
      enabled: true,
      poll: false,
    });
  });

  it('polls the receipt while the command runs', () => {
    render(
      <ReleaseCommand
        slug="api"
        deployment={deployment({
          status: 'snapshotting',
          release: { status: 'running', started_at: '2026-10-15T10:00:00Z' },
        })}
      />
    );
    expect(screen.getByRole('region', { name: 'Release command' })).toHaveTextContent('Running');
    expect(useReleaseTask).toHaveBeenLastCalledWith('api', 'a'.repeat(32), {
      enabled: true,
      poll: true,
    });
  });

  it('explains a failed command and shows its failure and stderr', () => {
    useReleaseTask.mockReturnValue(
      read({
        task: task({
          status: 'failed',
          exit_code: 1,
          stdout_tail: '',
          stderr_tail: 'relation "orders" already exists',
          failure: { code: 'nonzero_exit', message: 'command exited with status 1' },
          attempt_count: 2,
          output_truncated: true,
        }),
        searched: 1,
        complete: true,
      })
    );
    render(
      <ReleaseCommand
        slug="api"
        deployment={deployment({
          status: 'failed',
          error_code: 'release_command_failed',
          release: {
            status: 'failed',
            started_at: '2026-10-15T10:00:00Z',
            finished_at: '2026-10-15T10:01:05Z',
          },
        })}
      />
    );
    const panel = screen.getByRole('region', { name: 'Release command' });
    expect(within(panel).getByRole('alert')).toHaveTextContent(/previous release keeps serving/i);
    expect(panel).toHaveTextContent('nonzero_exit');
    expect(panel).toHaveTextContent('relation "orders" already exists');
    expect(panel).toHaveTextContent('1 min 5 s');
    expect(panel).toHaveTextContent(/only the last 64 KB/i);
    expect(panel).toHaveTextContent('Attempts');
  });

  it('says when this installation cannot run release commands', () => {
    render(
      <ReleaseCommand
        slug="api"
        deployment={deployment({
          status: 'failed',
          error_code: 'release_phase_unavailable',
          release: { status: 'pending' },
        })}
      />
    );
    const panel = screen.getByRole('region', { name: 'Release command' });
    expect(panel).toHaveTextContent('Could not run');
    expect(within(panel).getByRole('alert')).toHaveTextContent(/not enabled on this installation/i);
    expect(useReleaseTask).toHaveBeenCalledWith('api', 'a'.repeat(32), {
      enabled: false,
      poll: false,
    });
  });

  it('falls back to the release diff for the command before the task exists', () => {
    useReleaseDiff.mockReturnValue(
      read({ database: { changed: true, to_release_command: 'bin/rails db:migrate' } })
    );
    render(
      <ReleaseCommand
        slug="api"
        deployment={deployment({ status: 'building', release: { status: 'pending' } })}
      />
    );
    const panel = screen.getByRole('region', { name: 'Release command' });
    expect(panel).toHaveTextContent('bin/rails db:migrate');
    expect(panel).toHaveTextContent('Waiting for the image');
    expect(panel).toHaveTextContent(/output appears once the command starts/i);
  });

  it('says output is unavailable when the task API is off (501 not_implemented)', () => {
    useReleaseTask.mockReturnValue(
      read(undefined, {
        error: new ApiError({
          type: 'about:blank',
          status: 501,
          code: 'not_implemented',
          title: 'App task API unavailable',
        }),
      })
    );
    render(
      <ReleaseCommand slug="api" deployment={deployment({ release: { status: 'succeeded' } })} />
    );
    expect(screen.getByRole('region', { name: 'Release command' })).toHaveTextContent(
      /task output is not available on this installation/i
    );
  });

  it('says how far it looked when the task is not on the pages read', () => {
    useReleaseTask.mockReturnValue(read({ searched: 600, complete: false }));
    render(
      <ReleaseCommand slug="api" deployment={deployment({ release: { status: 'succeeded' } })} />
    );
    expect(screen.getByRole('region', { name: 'Release command' })).toHaveTextContent(
      'not among the app’s 600 newest tasks'
    );
  });
});
