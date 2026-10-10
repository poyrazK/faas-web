import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

const invalidateQueries = vi.fn();
const detail = {
  data: {
    issue: {
      id: 'issue-1',
      title: 'PaymentError',
      state: 'resolved',
      environment: 'application',
      event_count: 9,
      regression_count: 2,
      fixed_deployment_id: 'dep-1',
      assignee_account_id: 'account-1',
    },
    impact: {
      window_start: '2026-10-09T00:00:00Z',
      window_end: '2026-10-10T00:00:00Z',
      identified_customers: 3,
      observed_events: 4,
      unattributed_events: 1,
      coverage: 'retained_verified',
    },
    events: [
      {
        id: 'event-1',
        deployment_id: 'dep-1',
        received_at: '2026-10-10T00:00:00Z',
        attribution: 'verified',
      },
    ],
    releases: [
      {
        deployment_id: 'dep-1',
        event_count: 2,
        first_seen_at: '2026-10-09T00:00:00Z',
        last_seen_at: '2026-10-10T00:00:00Z',
      },
    ],
    activity: [
      { id: 'act-1', action: 'resolved', created_at: '2026-10-09T00:00:00Z', details: {} },
    ],
    next_event_cursor: 'ev-next',
    next_release_cursor: 'rel-next',
    next_activity_cursor: 'act-next',
  },
  isPending: false,
  error: null as Error | null,
  refetch: vi.fn(),
};
const histories = {
  events: {
    data: {
      pages: [
        {
          events: [{ id: 'event-2', received_at: '2026-10-08T00:00:00Z', attribution: 'unknown' }],
          next_event_cursor: undefined,
        },
      ],
    },
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
    error: null,
  },
  releases: {
    data: {
      pages: [
        {
          releases: [
            {
              deployment_id: 'dep-2',
              event_count: 1,
              first_seen_at: '2026-10-08T00:00:00Z',
              last_seen_at: '2026-10-08T00:00:00Z',
            },
          ],
          next_release_cursor: undefined,
        },
      ],
    },
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
    error: null,
  },
  activity: {
    data: {
      pages: [
        {
          activity: [
            { id: 'act-2', action: 'reopened', created_at: '2026-10-08T00:00:00Z', details: {} },
          ],
          next_activity_cursor: undefined,
        },
      ],
    },
    hasNextPage: false,
    fetchNextPage: vi.fn(),
    isFetchingNextPage: false,
    error: null,
  },
};
const useIssueHistory = vi.fn(
  (_: string, __: string, ___: string, kind: keyof typeof histories) => histories[kind]
);
const actOnIssue = vi.fn().mockResolvedValue({});
vi.mock('@/lib/api/issues', () => ({
  useIssueDetail: () => detail,
  useIssueDeployments: () => ({
    data: { pages: [{ items: [{ id: 'dep-1', status: 'active' }] }] },
    hasNextPage: false,
    error: null,
    fetchNextPage: vi.fn(),
  }),
  useIssueHistory: (...args: Parameters<typeof useIssueHistory>) => useIssueHistory(...args),
  actOnIssue: (...args: unknown[]) => actOnIssue(...args),
  issueDetailKey: () => ['detail'],
  issuesKey: () => ['list'],
}));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries }),
}));
const { IssueDetail } = await import('./issue-detail');

beforeEach(() => {
  useIssueHistory.mockClear();
  actOnIssue.mockClear();
  detail.data.issue.state = 'resolved';
});

it('keeps occurrence, release and activity continuations independent and bounds impact claims', () => {
  render(<IssueDetail accountId="account-1" slug="app-a" issueId="issue-1" onBack={vi.fn()} />);
  expect(screen.getByText(/retained.*verified/i)).toBeInTheDocument();
  expect(screen.getByText(/2 recurrences/i)).toBeInTheDocument();
  expect(useIssueHistory).toHaveBeenCalledWith(
    'account-1',
    'app-a',
    'issue-1',
    'events',
    '2026-10-09T00:00:00Z',
    'ev-next'
  );
  expect(useIssueHistory).toHaveBeenCalledWith(
    'account-1',
    'app-a',
    'issue-1',
    'releases',
    '2026-10-09T00:00:00Z',
    'rel-next'
  );
  expect(useIssueHistory).toHaveBeenCalledWith(
    'account-1',
    'app-a',
    'issue-1',
    'activity',
    '2026-10-09T00:00:00Z',
    'act-next'
  );
  expect(screen.getByText(/event-2/i)).toBeInTheDocument();
  expect(screen.getByText(/dep-2/i)).toBeInTheDocument();
  expect(screen.getByText(/reopened/i)).toBeInTheDocument();
});

it('requires an explicit action and includes a logical operation key', async () => {
  render(<IssueDetail accountId="account-1" slug="app-a" issueId="issue-1" onBack={vi.fn()} />);
  await userEvent.click(screen.getByRole('button', { name: 'Reopen issue' }));
  expect(actOnIssue).toHaveBeenCalledWith(
    'app-a',
    'issue-1',
    { action: 'reopen' },
    expect.any(String)
  );
  expect(invalidateQueries).toHaveBeenCalled();
});

it('only resolves against a listed app deployment and sends a bounded ignore deadline', async () => {
  detail.data.issue.state = 'open';
  render(<IssueDetail accountId="account-1" slug="app-a" issueId="issue-1" onBack={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Resolve with deployment' })).toBeDisabled();
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Fix deployment' }), 'dep-1');
  await userEvent.click(screen.getByRole('button', { name: 'Resolve with deployment' }));
  await waitFor(() =>
    expect(actOnIssue).toHaveBeenCalledWith(
      'app-a',
      'issue-1',
      { action: 'resolve', fixed_deployment_id: 'dep-1' },
      expect.any(String)
    )
  );
  await userEvent.click(screen.getByRole('button', { name: 'Ignore issue' }));
  await waitFor(() =>
    expect(actOnIssue).toHaveBeenCalledWith(
      'app-a',
      'issue-1',
      expect.objectContaining({ action: 'ignore', ignored_until: expect.any(String) }),
      expect.any(String)
    )
  );
});
