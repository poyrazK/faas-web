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
const off = new Set<string>();
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => capability,
  useCapabilityAccess: (key: string) => ({
    access: off.has(key) ? 'off' : 'on',
    refresh: vi.fn(),
  }),
}));
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
vi.mock('./issue-alert-policies', () => ({
  IssueAlertPolicies: () => <div>Alert policies page</div>,
}));
vi.mock('./issue-source-maps', () => ({
  IssueSourceMaps: () => <div>Source maps page</div>,
}));
vi.mock('./issue-trackers', () => ({
  LinearConnectionPanel: () => <div>Linear page</div>,
  IssueTrackerLinks: () => <div>Tracker links</div>,
}));
vi.mock('./issue-saved-views', () => ({
  IssueSavedViews: () => <div>Saved views bar</div>,
}));
const { IssuesBody } = await import('./issues-body');

beforeEach(() => {
  off.clear();
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

it('offers alert policies, source maps and Linear beside the inbox, each behind its capability', async () => {
  show();
  expect(screen.getByText('Saved views bar')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Alert policies' }));
  expect(onSearch).toHaveBeenCalledWith({ issueView: 'alerts', issue: undefined });
  await userEvent.click(screen.getByRole('button', { name: 'Source maps' }));
  expect(onSearch).toHaveBeenCalledWith({ issueView: 'sourcemaps', issue: undefined });
  await userEvent.click(screen.getByRole('button', { name: 'Linear' }));
  expect(onSearch).toHaveBeenCalledWith({ issueView: 'linear', issue: undefined });
});

it('hides the alert, Linear and saved-view previews while they are off, and explains a deep link', () => {
  off.add('issue-alert-policies');
  off.add('issue-trackers');
  off.add('issue-saved-views');
  const { unmount } = show();
  expect(screen.queryByRole('button', { name: 'Alert policies' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Linear' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Source maps' })).toBeInTheDocument();
  expect(screen.queryByText('Saved views bar')).toBeNull();
  unmount();
  show({ issueView: 'alerts' });
  expect(screen.getByText('Not enabled for this account')).toBeInTheDocument();
  expect(screen.queryByText('Alert policies page')).toBeNull();
});

it('shows tracker links under an issue only while issue-trackers is on', () => {
  const { unmount } = show({ issue: 'issue-1' });
  expect(screen.getByText('Tracker links')).toBeInTheDocument();
  unmount();
  off.add('issue-trackers');
  show({ issue: 'issue-1' });
  expect(screen.queryByText('Tracker links')).toBeNull();
});

it('passes a saved view’s team and tag to the list, never with an assignee', () => {
  show({
    issueTeam: '11111111-2222-4333-8444-555555555555',
    issueAssignee: 'me',
    issueTag: 'route=/checkout',
  });
  expect(useIssues).toHaveBeenCalledWith(
    'account-1',
    'app-a',
    expect.objectContaining({
      team: '11111111-2222-4333-8444-555555555555',
      tag: 'route=/checkout',
      assignee: undefined,
    })
  );
  expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeDisabled();
});
