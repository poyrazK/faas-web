import { expect, it } from 'vitest';
import { validateIssueSearch } from './issues-search';

it('keeps only bounded Issues search selections for app deep links', () => {
  expect(
    validateIssueSearch({
      issue: 'issue-1',
      issueState: 'open',
      issueSort: 'impact',
      issueMinCustomers: '3',
      issueView: 'setup',
    })
  ).toEqual({
    issue: 'issue-1',
    issueState: 'open',
    issueSort: 'impact',
    issueMinCustomers: 3,
    issueView: 'setup',
  });
  expect(
    validateIssueSearch({
      issueState: 'all',
      issueSort: 'random',
      issueMinCustomers: -1,
      issueView: 'unknown',
    })
  ).toEqual({
    issue: undefined,
    issueState: undefined,
    issueSort: undefined,
    issueMinCustomers: undefined,
    issueView: undefined,
  });
});

it('keeps a saved view’s team, tag and account assignee, and the new pages', () => {
  const team = '11111111-2222-4333-8444-555555555555';
  expect(
    validateIssueSearch({ issueTeam: team, issueAssignee: 'me', issueTag: 'route=/checkout' })
  ).toMatchObject({ issueTeam: team, issueAssignee: undefined, issueTag: 'route=/checkout' });
  expect(validateIssueSearch({ issueAssignee: team }).issueAssignee).toBe(team);
  expect(validateIssueSearch({ issueAssignee: 'someone' }).issueAssignee).toBeUndefined();
  expect(validateIssueSearch({ issueTag: 'no-equals' }).issueTag).toBeUndefined();
  for (const view of ['alerts', 'sourcemaps', 'linear'])
    expect(validateIssueSearch({ issueView: view }).issueView).toBe(view);
});
