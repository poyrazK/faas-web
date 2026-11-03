import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import { viewKey } from '@/lib/api/issue-policies';
import { IssueSavedViews, filtersFromSearch, searchFromFilters } from './issue-saved-views';

const TEAM = '11111111-2222-4333-8444-555555555555';
const triage = {
  key: 'triage',
  name: 'Triage',
  filters: { state: 'open', assignee: 'unassigned', sort: 'impact' },
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};
const payments = {
  key: 'payments-team',
  name: 'Payments team',
  filters: { team: TEAM, tag: 'route=/checkout' },
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

let puts: { key?: string; body: unknown }[];
let deletes: string[];
function api(extra: Handlers = {}) {
  return routeApi({
    'GET /v1/apps/{slug}/issue-saved-views': () => ({ items: [payments, triage] }),
    'PUT /v1/apps/{slug}/issue-saved-views/{view_key}': ({ params, body }) => {
      puts.push({ key: params?.path?.view_key, body });
      return {
        key: params?.path?.view_key,
        ...(body as object),
        created_at: '2026-11-03T00:00:00Z',
        updated_at: '2026-11-03T00:00:00Z',
      };
    },
    'DELETE /v1/apps/{slug}/issue-saved-views/{view_key}': ({ params }) => {
      deletes.push(String(params?.path?.view_key));
      return undefined;
    },
    ...extra,
  });
}

const onApply = vi.fn();
beforeEach(() => {
  puts = [];
  deletes = [];
  onApply.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('IssueSavedViews', () => {
  it('applies a view by replacing every inbox filter with its own', async () => {
    api();
    renderWithProviders(
      <IssueSavedViews
        accountId="acct"
        slug="shop"
        search={{ issueEnvironment: 'staging' }}
        onApply={onApply}
      />
    );
    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Saved view' }),
      'payments-team'
    );
    expect(onApply).toHaveBeenCalledWith({
      issueState: undefined,
      issueEnvironment: undefined,
      issueAssignee: undefined,
      issueSort: undefined,
      issueMinCustomers: undefined,
      issueTag: 'route=/checkout',
      issueTeam: TEAM,
      issue: undefined,
    });
  });

  it('recognises the view the current filters match', async () => {
    api();
    renderWithProviders(
      <IssueSavedViews
        accountId="acct"
        slug="shop"
        search={{ issueState: 'open', issueAssignee: 'unassigned', issueSort: 'impact' }}
        onApply={onApply}
      />
    );
    expect(await screen.findByRole('combobox', { name: 'Saved view' })).toHaveValue('triage');
  });

  it('saves the current filters under a key made from the name', async () => {
    api();
    renderWithProviders(
      <IssueSavedViews
        accountId="acct"
        slug="shop"
        search={{ issueState: 'resolved', issueMinCustomers: 5 }}
        onApply={onApply}
      />
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save these filters' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'View name' }), 'Big resolved!');
    await userEvent.click(screen.getByRole('button', { name: 'Save view' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({
      key: 'big-resolved',
      body: { name: 'Big resolved!', filters: { state: 'resolved', min_customers: 5 } },
    });
    expect(await screen.findByRole('option', { name: 'Big resolved!' })).toBeInTheDocument();
  });

  it('explains the 20-view quota from its code', async () => {
    api({
      'PUT /v1/apps/{slug}/issue-saved-views/{view_key}': () =>
        problem(409, 'issue_quota_exceeded', 'quota'),
    });
    renderWithProviders(
      <IssueSavedViews accountId="acct" slug="shop" search={{}} onApply={onApply} />
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Save these filters' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'View name' }), 'one more');
    await userEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already has 20 saved views');
  });

  it('deletes the open view after confirming, for everyone', async () => {
    api();
    renderWithProviders(
      <IssueSavedViews
        accountId="acct"
        slug="shop"
        search={{ issueTeam: TEAM, issueTag: 'route=/checkout' }}
        onApply={onApply}
      />
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Delete view Payments team' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('removed for everyone');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete view' }));
    await waitFor(() => expect(deletes).toEqual(['payments-team']));
  });
});

describe('saved view mapping', () => {
  it('maps filters both ways, with team winning over an assignee', () => {
    expect(
      filtersFromSearch({ issueTeam: TEAM, issueAssignee: 'me', issueSort: 'impact' })
    ).toEqual({ team: TEAM, sort: 'impact' });
    expect(searchFromFilters({ assignee: 'me', team: TEAM }).issueAssignee).toBeUndefined();
    expect(viewKey('  Payments: P1 / EU  ')).toBe('payments-p1-eu');
    expect(viewKey('!!!')).toBe('');
  });
});
