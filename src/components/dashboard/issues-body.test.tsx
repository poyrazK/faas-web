import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import type { IssueSearch } from './issues-search';

const onSearch = vi.fn();
const capability = {
  accountId: 'account-1',
  state: 'available',
  capability: { maturity: 'preview' },
  refresh: vi.fn(),
};
const list = {
  data: {
    pages: [
      {
        items: [
          {
            id: 'issue-1',
            title: 'PaymentError',
            state: 'open',
            environment: 'application',
            event_count: 9,
            regression_count: 2,
            last_seen_at: '2026-10-10T00:00:00Z',
            impact_24h: { identified_customers: 3, observed_events: 4, unattributed_events: 1 },
          },
        ],
        next_cursor: 'next-1',
      },
    ],
  },
  isPending: false,
  error: null as Error | null,
  hasNextPage: true,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
};
const useIssues = vi.fn(() => list);
vi.mock('@/lib/api/capabilities', () => ({ useCapability: () => capability }));
vi.mock('@/lib/api/issues', () => ({
  useIssues: (...args: Parameters<typeof useIssues>) => useIssues(...args),
}));
vi.mock('@/components/dashboard/capability-notice', () => ({
  CapabilityNotice: ({ state }: { state: string }) => <span>Capability: {state}</span>,
}));
vi.mock('@/components/dashboard/issue-detail', () => ({
  IssueDetail: () => <div>Issue detail</div>,
}));
vi.mock('@/components/dashboard/issue-reporting-setup', () => ({
  IssueReportingSetup: () => <div>Reporting setup</div>,
}));
const { IssuesBody } = await import('./issues-body');

beforeEach(() => {
  onSearch.mockReset();
  useIssues.mockClear();
  capability.state = 'available';
  capability.accountId = 'account-1';
  list.error = null;
  list.isPending = false;
  list.hasNextPage = true;
  list.data.pages[0].items = [
    {
      id: 'issue-1',
      title: 'PaymentError',
      state: 'open',
      environment: 'application',
      event_count: 9,
      regression_count: 2,
      last_seen_at: '2026-10-10T00:00:00Z',
      impact_24h: { identified_customers: 3, observed_events: 4, unattributed_events: 1 },
    },
  ];
});

function show(search: IssueSearch = {}) {
  return render(
    <IssuesBody accountId="account-1" slug="app-a" search={search} onSearch={onSearch} />
  );
}

it('shows instrumented Issues separately from automatic HTTP Errors and observed impact bounds', async () => {
  show();
  expect(screen.getByText(/instrumented exceptions/i)).toBeInTheDocument();
  expect(screen.getByText(/retained.*verified/i)).toBeInTheDocument();
  expect(screen.getByText('PaymentError')).toBeInTheDocument();
  expect(screen.getByText(/3 verified customers/i)).toBeInTheDocument();
  expect(screen.getByText(/2 recurrences/i)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'PaymentError' }));
  expect(onSearch).toHaveBeenCalledWith(expect.objectContaining({ issue: 'issue-1' }));
});

it('keys filters, ownership, ordering and bounded pagination to the selected app', async () => {
  show({ issueState: 'open', issueAssignee: 'me', issueSort: 'impact', issueMinCustomers: 3 });
  expect(useIssues).toHaveBeenCalledWith('account-1', 'app-a', {
    state: 'open',
    assignee: 'me',
    sort: 'impact',
    min_customers: 3,
    environment: undefined,
  });
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Issue state' }), 'resolved');
  expect(onSearch).toHaveBeenCalledWith(
    expect.objectContaining({ issueState: 'resolved', issue: undefined })
  );
  await userEvent.click(screen.getByRole('button', { name: 'Load more issues' }));
  expect(list.fetchNextPage).toHaveBeenCalled();
});

it('gates setup on current capability while showing a truthful unavailable state', async () => {
  capability.state = 'plan-not-entitled';
  show();
  expect(screen.getByText('Capability: plan-not-entitled')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reporting setup' })).toBeDisabled();
  expect(screen.queryByText('PaymentError')).not.toBeInTheDocument();
});

it('opens reporting setup through a URL-backed view', async () => {
  show();
  await userEvent.click(screen.getByRole('button', { name: 'Reporting setup' }));
  expect(onSearch).toHaveBeenCalledWith(
    expect.objectContaining({ issueView: 'setup', issue: undefined })
  );
});
