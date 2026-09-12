import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { DeploymentProgress } from './deployment-progress';

const api = vi.hoisted(() => ({
  status: 'pending',
  error: '',
  why: '',
  fix: '',
  readFailed: false,
  refetch: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({
  useDeployment: () => ({
    data: {
      id: 'deploy-1',
      app_id: 'app-1',
      kind: 'github',
      image_digest: '',
      created_at: '2026-09-12T00:00:00Z',
      status: api.status,
      error: api.error,
      error_why: api.why,
      error_fix: api.fix,
      error_relevant_logs: [{ message: 'server-selected excerpt' }],
    },
    isError: api.readFailed,
    refetch: api.refetch,
  }),
}));
vi.mock('@/lib/api/logs', () => ({
  useLogStream: () => ({ lines: [], status: 'streaming', reason: null }),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => api.navigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const props = {
  appCreated: true,
  appName: 'hello-app',
  deploymentId: 'deploy-1',
  repo: 'team/hello',
  sourceRef: 'feature/start',
  endpoint: 'https://hello.example',
};

beforeEach(() => {
  api.status = 'pending';
  api.error = '';
  api.why = '';
  api.fix = '';
  api.readFailed = false;
  api.refetch.mockClear();
});

describe('first deployment progress', () => {
  it.each([
    ['pending', 'Queued for build'],
    ['building', 'Building your app'],
    ['imaging', 'Preparing the image'],
    ['snapshotting', 'Preparing the runtime'],
    ['cancelled', 'Deployment cancelled'],
    ['future-stage', 'Deployment in progress'],
  ])('describes the actual %s state without enabling the endpoint', (status, title) => {
    api.status = status;
    render(<DeploymentProgress {...props} />);
    expect(screen.getByRole('heading', { name: title })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: props.endpoint })).not.toBeInTheDocument();
  });

  it('offers the API-assigned endpoint only after the deployment is live', () => {
    const { rerender } = render(<DeploymentProgress {...props} />);
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
    api.status = 'live';
    rerender(<DeploymentProgress {...props} />);
    expect(screen.getByRole('link', { name: 'Open app' })).toHaveAttribute('href', props.endpoint);
    api.status = 'superseded';
    rerender(<DeploymentProgress {...props} />);
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
  });

  it('does not invent an endpoint for a live app without one', () => {
    api.status = 'live';
    render(<DeploymentProgress {...props} endpoint={null} />);
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
  });

  it('shows the failure and a route to deployment recovery', () => {
    api.status = 'failed';
    api.error = 'The start command exited with code 1.';
    render(<DeploymentProgress {...props} />);
    expect(screen.getByRole('region', { name: 'Failure explanation' })).toHaveTextContent(
      api.error
    );
    expect(screen.getByRole('link', { name: 'Review deployment' })).toBeVisible();
  });

  it('does not report stale live data as verified when the status read fails', () => {
    api.status = 'live';
    api.readFailed = true;
    render(<DeploymentProgress {...props} />);
    expect(screen.getByRole('heading', { name: 'Status temporarily unavailable' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
  });

  it('surfaces the server explanation and remediation ahead of raw logs', () => {
    api.status = 'failed';
    api.error = 'exit status 1';
    api.why = 'The configured start command could not be found.';
    api.fix = 'Set the start command to an executable in your image.';
    render(<DeploymentProgress {...props} />);
    expect(screen.getByRole('region', { name: 'Failure explanation' })).toHaveTextContent(api.why);
    expect(screen.getByRole('region', { name: 'Failure explanation' })).toHaveTextContent(api.fix);
    expect(screen.getByText('Build output').closest('details')).toHaveAttribute('open');
  });

  it('lets the user refresh an unavailable status without redeploying', async () => {
    api.readFailed = true;
    render(<DeploymentProgress {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(api.refetch).toHaveBeenCalledOnce();
  });

  it('shows relevant evidence and routes to retry options for the exact failed deployment', async () => {
    api.status = 'failed';
    render(<DeploymentProgress {...props} />);
    expect(screen.getByText('server-selected excerpt')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'View build output' }));
    expect(screen.getByText('Build output')).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Retry options' }));
    expect(api.navigate).toHaveBeenCalledWith({
      to: '/dashboard/deployments',
      search: { deployment: 'deploy-1', releaseSection: 'lifecycle' },
    });
  });

  it('keeps submission failure distinct from a running deployment', () => {
    render(
      <DeploymentProgress {...props} deploymentId={null} submissionError="GitHub unavailable" />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('GitHub unavailable');
    expect(screen.queryByRole('link', { name: 'Open app' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review deployment' })).not.toBeInTheDocument();
  });
});
