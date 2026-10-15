import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { apps } from '../../../../mock/data';
import { PreviewWorkloadSet } from './preview-workload-set';
vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params?: Record<string, string>;
    children: React.ReactNode;
  }) => <a href={to.replace('$workflowId', params?.workflowId ?? '')}>{children}</a>,
}));
afterEach(() => vi.restoreAllMocks());
const app = {
  ...apps[0],
  slug: 'preview-api',
  preview_of_slug: 'api',
  preview_pr_number: 7,
  preview_pr_state: 'open' as const,
  preview_expires_at: '2026-10-15T10:00:00Z',
};
function mount() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <PreviewWorkloadSet accountId="a" app={app} />
    </QueryClientProvider>
  );
}
const member = {
  app_id: 'a1',
  slug: 'preview-api',
  workload_name: 'api',
  app_status: 'active',
  preview_state: 'open',
  deployment_id: 'd1',
  deployment_status: 'live',
  links: {
    url: 'https://assigned-preview.example.test',
    logs: '/v1/apps/preview-api/logs',
    metrics: '/v1/apps/preview-api/metrics',
    configuration: '/v1/apps/preview-api',
  },
};
it('uses the exact recorded root and returned preview links, not guessed hosts', async () => {
  vi.spyOn(api, 'GET').mockResolvedValue({
    data: {
      root_slug: 'preview-api',
      repo_full_name: 'acme/shop',
      pr_number: 7,
      commit_sha: 'new-head',
      phase: 'live',
      ready: true,
      summary: 'All live',
      live_workloads: 1,
      total_workloads: 1,
      members: [member],
    },
    response: new Response(),
  } as never);
  mount();
  expect(await screen.findByText('Ready for this commit')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open preview' })).toHaveAttribute(
    'href',
    'https://assigned-preview.example.test/'
  );
  expect(screen.getByText('new-head')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Production parent' })).toHaveAttribute(
    'href',
    '/dashboard/workflows/api'
  );
});
it('does not imply a whole legacy set is ready when no set was recorded', async () => {
  const get = vi.spyOn(api, 'GET').mockResolvedValue({
    error: { status: 404, code: 'preview_environment_not_found', title: 'No set' },
    response: new Response('{}', { status: 404 }),
  } as never);
  mount();
  expect(await screen.findByText('Workload set unavailable')).toBeInTheDocument();
  expect(screen.getByText(/App-level information only/)).toBeInTheDocument();
  expect(screen.queryByText('Ready for this commit')).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledTimes(1);
});
it('shows a missing expected sibling instead of an old live artifact', async () => {
  vi.spyOn(api, 'GET').mockResolvedValue({
    data: {
      root_slug: 'preview-api',
      repo_full_name: 'acme/shop',
      pr_number: 7,
      commit_sha: 'new-head',
      phase: 'building',
      ready: false,
      summary: 'Missing worker',
      live_workloads: 1,
      total_workloads: 2,
      members: [
        member,
        {
          app_id: 'a2',
          slug: '',
          workload_name: 'worker',
          app_status: 'missing',
          preview_state: 'missing',
          deployment_id: '',
          deployment_status: 'missing',
        },
      ],
    },
    response: new Response(),
  } as never);
  mount();
  expect(await screen.findByText('Missing worker')).toBeInTheDocument();
  expect(screen.getByText(/^Missing app/)).toBeInTheDocument();
  expect(screen.queryByText('Ready for this commit')).not.toBeInTheDocument();
});
