import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const tokens = {
  data: [] as {
    id: string;
    name: string;
    deployment_id: string;
    environment: string;
    expires_at: string;
    revoked_at?: string;
  }[],
  isPending: false,
  error: null,
  refetch: vi.fn().mockResolvedValue({ isSuccess: true }),
};
const deployments = {
  data: {
    pages: [
      {
        items: [{ id: 'dep-1', status: 'active', created_at: '2026-10-09T00:00:00Z' }],
        next_before: undefined,
      },
    ],
  },
  isPending: false,
  error: null,
  hasNextPage: false,
  fetchNextPage: vi.fn(),
};
const capability = { accountId: 'account-1', state: 'available', refresh: vi.fn() };
const createIssueTokenOnce = vi.fn().mockResolvedValue({
  id: 'tok-1',
  token: 'g_issue_secret',
  name: 'production',
  deployment_id: 'dep-1',
  environment: 'application',
  expires_at: '2026-10-11T00:00:00Z',
});
const revokeIssueToken = vi.fn().mockResolvedValue({});
const projectChoice = {
  projects: [] as { id: string; slug: string }[],
  project: undefined as { workloads: { slug: string }[] } | undefined,
  environments: undefined as { id: string; slug: string }[] | undefined,
  state: undefined as
    | {
        active_release_set: { members: { app_id: string; deployment_id: string }[] };
        workloads: { workload_slug: string; app_id: string }[];
      }
    | undefined,
};
vi.mock('@/lib/api/issues', () => ({
  useIssueTokens: () => tokens,
  useIssueDeployments: () => deployments,
  createIssueTokenOnce: (...args: unknown[]) => createIssueTokenOnce(...args),
  revokeIssueToken: (...args: unknown[]) => revokeIssueToken(...args),
  issueTokensKey: () => ['tokens'],
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapability: () => capability }));
vi.mock('@/lib/api/projects', () => ({
  useProjects: () => ({ data: projectChoice.projects }),
  useProject: () => ({ data: projectChoice.project }),
  useProjectEnvironments: () => ({ data: projectChoice.environments }),
  useEnvironmentState: () => ({ data: projectChoice.state }),
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
const { IssueReportingSetup } = await import('./issue-reporting-setup');

beforeEach(() => {
  sessionStorage.clear();
  tokens.data = [];
  tokens.refetch.mockClear();
  createIssueTokenOnce.mockClear();
  revokeIssueToken.mockClear();
  capability.state = 'available';
  capability.accountId = 'account-1';
  projectChoice.projects = [];
  projectChoice.project = undefined;
  projectChoice.environments = undefined;
  projectChoice.state = undefined;
});

async function fillAndCreate() {
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Deployment' }), 'dep-1');
  await userEvent.type(screen.getByRole('textbox', { name: 'Token name' }), 'production');
  await userEvent.click(screen.getByRole('button', { name: 'Create reporting token' }));
}

it('creates against an authoritative deployment and keeps the bearer behind acknowledgment', async () => {
  render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  await fillAndCreate();
  await waitFor(() => expect(createIssueTokenOnce).toHaveBeenCalledTimes(1));
  expect(createIssueTokenOnce).toHaveBeenCalledWith(
    'app-a',
    expect.objectContaining({
      deployment_id: 'dep-1',
      environment: 'application',
      name: 'production',
    })
  );
  expect(screen.getByDisplayValue('g_issue_secret')).toHaveAttribute('type', 'password');
  expect(screen.getByRole('dialog', { name: 'Save reporting token' })).toContainElement(
    screen.getByDisplayValue('g_issue_secret')
  );
  expect(screen.getByRole('button', { name: 'Back to issues' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: /saved this token/i }));
  await userEvent.click(screen.getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByDisplayValue('g_issue_secret')).not.toBeInTheDocument());
});

it('treats a lost create response as unresolved and never mints again automatically', async () => {
  createIssueTokenOnce.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  await fillAndCreate();
  await waitFor(() => expect(screen.getByText(/outcome is uncertain/i)).toBeInTheDocument());
  expect(tokens.refetch).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Create reporting token' })).toBeDisabled();
  expect(createIssueTokenOnce).toHaveBeenCalledTimes(1);
});

it('offers a named environment only with project membership and an exact release member', async () => {
  projectChoice.projects = [{ id: 'project-1', slug: 'shop' }];
  projectChoice.project = { workloads: [{ slug: 'app-a' }] };
  projectChoice.environments = [{ id: 'env-1', slug: 'staging' }];
  projectChoice.state = {
    active_release_set: { members: [{ app_id: 'app-id', deployment_id: 'dep-1' }] },
    workloads: [{ workload_slug: 'app-a', app_id: 'app-id' }],
  };
  render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'shop');
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Environment' }), 'staging');
  await fillAndCreate();
  expect(createIssueTokenOnce).toHaveBeenCalledWith(
    'app-a',
    expect.objectContaining({ deployment_id: 'dep-1', environment: 'staging' })
  );
});

it('does not show a late bearer after account context changes', async () => {
  let resolve!: (value: unknown) => void;
  createIssueTokenOnce.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const view = render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  await fillAndCreate();
  view.rerender(<IssueReportingSetup accountId="account-2" slug="app-b" onClose={vi.fn()} />);
  resolve({
    id: 'tok-1',
    token: 'g_issue_late',
    name: 'production',
    deployment_id: 'dep-1',
    environment: 'application',
    expires_at: '2026-10-11T00:00:00Z',
  });
  await waitFor(() => expect(screen.queryByDisplayValue('g_issue_late')).not.toBeInTheDocument());
  expect(sessionStorage.getItem('gregale.issue-token-recovery.account-1.app-a')).toContain('tok-1');
});

it('records the attempt before a pending create can outlive the view', async () => {
  let resolve!: (value: unknown) => void;
  createIssueTokenOnce.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const view = render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  await fillAndCreate();
  expect(sessionStorage.getItem('gregale.issue-token-recovery.account-1.app-a')).toContain(
    'production'
  );
  view.unmount();
  resolve({
    id: 'tok-1',
    token: 'g_issue_late',
    name: 'production',
    deployment_id: 'dep-1',
    environment: 'application',
    expires_at: '2026-10-11T00:00:00Z',
  });
  await waitFor(() =>
    expect(sessionStorage.getItem('gregale.issue-token-recovery.account-1.app-a')).toContain(
      'tok-1'
    )
  );
  render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Create reporting token' })).toBeDisabled();
  expect(screen.queryByDisplayValue('g_issue_late')).not.toBeInTheDocument();
});

it('matches an ambiguous token by expiry instant despite Go timestamp normalization', () => {
  sessionStorage.setItem(
    'gregale.issue-token-recovery.account-1.app-a',
    JSON.stringify({
      name: 'production',
      deploymentId: 'dep-1',
      environment: 'application',
      expiresAt: '2099-01-01T00:00:00.120Z',
    })
  );
  tokens.data = [
    {
      id: 'tok-1',
      name: 'production',
      deployment_id: 'dep-1',
      environment: 'application',
      expires_at: '2099-01-01T00:00:00.12Z',
    },
  ];
  render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  expect(screen.getByText(/1 exact metadata match/i)).toBeInTheDocument();
});

it('reviews revocation by token ID even when names collide', async () => {
  tokens.data = [
    {
      id: 'tok-1',
      name: 'production',
      deployment_id: 'dep-1',
      environment: 'application',
      expires_at: '2099-01-01T00:00:00Z',
    },
    {
      id: 'tok-2',
      name: 'production',
      deployment_id: 'dep-1',
      environment: 'application',
      expires_at: '2099-01-01T00:00:00Z',
    },
  ];
  render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  await userEvent.click(screen.getAllByRole('button', { name: 'Review revoke' })[0]);
  expect(
    screen.getByText(/Revoke only this identified token: production \(tok-1\)/i)
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Revoke this token' }));
  await waitFor(() => expect(revokeIssueToken).toHaveBeenCalledWith('app-a', 'tok-1'));
  expect(revokeIssueToken).toHaveBeenCalledTimes(1);
});

it('remembers a non-secret recovery record after reload without redisclosing a bearer', async () => {
  const view = render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  await fillAndCreate();
  await screen.findByRole('dialog', { name: 'Save reporting token' });
  view.unmount();
  render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  expect(screen.getByText(/outcome is uncertain|cannot be recovered/i)).toBeInTheDocument();
  expect(screen.queryByDisplayValue('g_issue_secret')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create reporting token' })).toBeDisabled();
});

it('reports a confirmed token quota denial without entering ambiguous recovery', async () => {
  createIssueTokenOnce.mockRejectedValueOnce(
    new ApiError({
      status: 409,
      code: 'issue_quota_exceeded',
      title: 'Issue limit exceeded',
      detail: 'Reporting token quota reached.',
    })
  );
  render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  await fillAndCreate();
  await screen.findByText('Reporting token quota reached.');
  expect(screen.getByRole('button', { name: 'Create reporting token' })).toBeEnabled();
  expect(tokens.refetch).not.toHaveBeenCalled();
});

it('unblocks reviewed recovery when metadata confirms the identified token is revoked', async () => {
  sessionStorage.setItem(
    'gregale.issue-token-recovery.account-1.app-a',
    JSON.stringify({
      name: 'production',
      deploymentId: 'dep-1',
      environment: 'application',
      expiresAt: '2099-01-01T00:00:00Z',
      tokenId: 'tok-1',
    })
  );
  tokens.data = [
    {
      id: 'tok-1',
      name: 'production',
      deployment_id: 'dep-1',
      environment: 'application',
      expires_at: '2099-01-01T00:00:00Z',
    },
  ];
  tokens.refetch.mockResolvedValueOnce({
    isSuccess: true,
    data: [{ ...tokens.data[0], revoked_at: '2026-10-10T00:00:00Z' }],
  });
  render(<IssueReportingSetup accountId="account-1" slug="app-a" onClose={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Create reporting token' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Review revoke' }));
  await userEvent.click(screen.getByRole('button', { name: 'Revoke this token' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Create reporting token' })).toBeEnabled()
  );
  expect(sessionStorage.getItem('gregale.issue-token-recovery.account-1.app-a')).toBeNull();
});
