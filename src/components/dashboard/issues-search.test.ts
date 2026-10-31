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
