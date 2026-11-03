export type IssueView = 'inbox' | 'setup' | 'alerts' | 'sourcemaps' | 'linear';
const VIEWS: readonly IssueView[] = ['inbox', 'setup', 'alerts', 'sourcemaps', 'linear'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type IssueSearch = {
  issue?: string;
  issueState?: 'open' | 'resolved' | 'ignored';
  issueEnvironment?: string;
  /** `me`, `unassigned`, or an account UUID a saved view names. */
  issueAssignee?: string;
  issueSort?: 'recent' | 'impact';
  issueMinCustomers?: number;
  /** An exact operational `key=value` on retained occurrences (apid `tag`). */
  issueTag?: string;
  /** A team inbox UUID, from a saved view; exclusive with the assignee. */
  issueTeam?: string;
  issueView?: IssueView;
};

export function validateIssueSearch(raw: Record<string, unknown>): IssueSearch {
  const count =
    typeof raw.issueMinCustomers === 'string' && /^\d+$/.test(raw.issueMinCustomers)
      ? Number(raw.issueMinCustomers)
      : raw.issueMinCustomers;
  const team =
    typeof raw.issueTeam === 'string' && UUID.test(raw.issueTeam) ? raw.issueTeam : undefined;
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
      !team &&
      (raw.issueAssignee === 'me' ||
        raw.issueAssignee === 'unassigned' ||
        (typeof raw.issueAssignee === 'string' && UUID.test(raw.issueAssignee)))
        ? raw.issueAssignee
        : undefined,
    issueSort: raw.issueSort === 'recent' || raw.issueSort === 'impact' ? raw.issueSort : undefined,
    issueMinCustomers:
      typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 && count <= 10000
        ? count
        : undefined,
    issueTag:
      typeof raw.issueTag === 'string' && raw.issueTag.includes('=') && raw.issueTag.length <= 193
        ? raw.issueTag
        : undefined,
    issueTeam: team,
    issueView: VIEWS.includes(raw.issueView as IssueView)
      ? (raw.issueView as IssueView)
      : undefined,
  };
}
