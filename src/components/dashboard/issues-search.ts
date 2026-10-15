export type IssueSearch = {
  issue?: string;
  issueState?: 'open' | 'resolved' | 'ignored';
  issueEnvironment?: string;
  issueAssignee?: 'me' | 'unassigned';
  issueSort?: 'recent' | 'impact';
  issueMinCustomers?: number;
  issueView?: 'inbox' | 'setup';
};

export function validateIssueSearch(raw: Record<string, unknown>): IssueSearch {
  const count =
    typeof raw.issueMinCustomers === 'string' && /^\d+$/.test(raw.issueMinCustomers)
      ? Number(raw.issueMinCustomers)
      : raw.issueMinCustomers;
  return {
    issue: typeof raw.issue === 'string' && raw.issue.trim() ? raw.issue : undefined,
    issueState:
      raw.issueState === 'open' || raw.issueState === 'resolved' || raw.issueState === 'ignored'
        ? raw.issueState
        : undefined,
    issueEnvironment:
      typeof raw.issueEnvironment === 'string' && raw.issueEnvironment.trim()
        ? raw.issueEnvironment
        : undefined,
    issueAssignee:
      raw.issueAssignee === 'me' || raw.issueAssignee === 'unassigned'
        ? raw.issueAssignee
        : undefined,
    issueSort: raw.issueSort === 'recent' || raw.issueSort === 'impact' ? raw.issueSort : undefined,
    issueMinCustomers:
      typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= 10000
        ? count
        : undefined,
    issueView: raw.issueView === 'inbox' || raw.issueView === 'setup' ? raw.issueView : undefined,
  };
}
