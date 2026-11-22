import type {
  AgentActivityEntry,
  AgentApproval,
  AgentBudget,
  AgentConnection,
  AgentPolicy,
  AgentPolicyChange,
  AgentUndoItem,
} from '@/lib/api/agents';
import { formatCents, parseUsdMillicents } from '@/lib/money';

/**
 * The Agents pages in plain English (docs/console-plain-english.md). Every
 * sentence is built from fields the API returns; where the API does not say,
 * the sentence says less.
 */

export type AgentTone = 'good' | 'warning' | 'critical' | 'none';

/** apid's api.MaxAgentBudgetCents (pkg/api/limits.go): $1,000,000 a month. */
export const AGENT_BUDGET_MAX_CENTS = 100_000_000;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a", "a and b", "a, b and c". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** The name a person recognises: the client its consent page showed, else the key label. */
export function agentName(agent: Pick<AgentConnection, 'client_name' | 'label' | 'prefix'>) {
  return agent.client_name || agent.label || `Agent ${agent.prefix}`;
}

const KIND_WORDS: Record<AgentConnection['kind'], { label: string; help: string }> = {
  hosted_mcp: {
    label: 'Signed in',
    help: 'Connected by signing in through the hosted MCP server (hosted_mcp).',
  },
  agent_key: {
    label: 'Agent key',
    help: 'Uses an API key with the agent scope (agent_key).',
  },
  app_agent: {
    label: 'One-app key',
    help: 'Uses a credential that works for a single app (app_agent).',
  },
};

export const kindWords = (kind: AgentConnection['kind']) =>
  KIND_WORDS[kind] ?? { label: kind, help: kind };

/** Where the agent can act. An app-bound key reports the app's id, not its name. */
export function reachWords(agent: Pick<AgentConnection, 'kind' | 'projects'>): string {
  if (agent.kind === 'app_agent') return 'One app';
  if (agent.projects === undefined) return 'Every project';
  if (agent.projects.length === 0) return 'No project';
  return listWords(agent.projects);
}

/** What each scope lets an agent do, in the docs' words (content/docs/agents.md). */
const SCOPE_WORDS: Record<string, string> = {
  admin: 'do anything on the account',
  'apps:read': 'inspect apps, deployments, logs and metrics',
  'deploy:write': 'deploy, roll back, change app settings and delete apps',
  'env:write': 'set variables',
  'secrets:write': 'store secrets',
  'secrets:request': 'ask a person to enter a secret',
  'storage:manage': 'manage buckets',
  'storage:read': 'read buckets',
  'postgres:manage': 'manage databases',
  'postgres:read': 'read database settings',
  'usage:read': 'see usage and costs',
  'data:read': 'read app data',
};

/** `agent` marks the key as an agent's; it grants nothing by itself. */
const MARKER_SCOPES = new Set(['agent']);

/** One phrase per scope the agent holds; an unknown scope keeps its exact name. */
export function scopePhrases(scopes: readonly string[]): string[] {
  return scopes.filter((s) => !MARKER_SCOPES.has(s)).map((s) => SCOPE_WORDS[s] ?? s);
}

/** The one-word answer to "can it change things?". */
export function accessLevel(scopes: readonly string[]): string {
  if (scopes.includes('admin')) return 'Full access';
  if (scopes.some((s) => /:(write|manage)$/.test(s))) return 'Can make changes';
  return 'Read only';
}

const APPROVAL_KINDS: Record<string, string> = {
  delete: 'deletes',
  production: 'production changes',
  credentials: 'new or rotated credentials',
  billing: 'billing changes',
};

/** The actions an agent must have a person approve. */
export function asksBefore(approvals: readonly string[] | undefined): string {
  if (approvals === undefined) return '';
  if (approvals.length === 0) return 'Nothing';
  return listWords(approvals.map((kind) => APPROVAL_KINDS[kind] ?? kind));
}

const CATEGORY_WORDS: Record<AgentApproval['category'], string> = {
  delete: 'delete something',
  production: 'change production',
  credentials: 'create or rotate credentials',
  billing: 'change billing',
  budget: 'go over its monthly budget',
  undo: 'undo its own changes',
};

/** "Claude Code wants to change production". */
export function approvalSentence(approval: Pick<AgentApproval, 'agent' | 'category'>): string {
  const what = CATEGORY_WORDS[approval.category] ?? `do something (${approval.category})`;
  return `${approval.agent || 'An agent'} wants to ${what}`;
}

/** "22 min left", "under a minute left", or "Expired". */
export function timeLeft(expiresAt: string, now: number = Date.now()): string {
  const ms = Date.parse(expiresAt) - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'Expired';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute left';
  if (minutes < 60) return `${minutes} min left`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
}

/** The page's opening sentence: how many agents, and whether anything waits. */
export function agentsAnswer(
  connections: readonly AgentConnection[],
  pending: number | undefined
): { tone: AgentTone; sentence: string } {
  const count = connections.length;
  const connected =
    count === 0
      ? 'No agents are connected.'
      : `${plural(count, 'agent is', 'agents are')} connected.`;
  if (pending === undefined) return { tone: 'none', sentence: connected };
  if (pending > 0)
    return {
      tone: 'warning',
      sentence: `${connected} ${plural(pending, 'request is', 'requests are')} waiting for your approval.`,
    };
  return {
    tone: count === 0 ? 'none' : 'good',
    sentence:
      count === 0
        ? `${connected} Connect one to let it deploy and look after your apps.`
        : `${connected} Nothing is waiting for you.`,
  };
}

export interface BudgetWords {
  /** "$3.20 of $25.00" or "$3.20, no limit". */
  amount: string;
  /** Where the limit comes from, as a sentence. */
  source: string;
  /** Share of the budget committed, 0–1; undefined without a limit. */
  ratio: number | undefined;
  tone: AgentTone;
}

/** An agent's always-on budget this month. */
export function budgetWords(budget: AgentBudget): BudgetWords {
  const spent = formatCents(budget.spent_cents);
  const limit = budget.monthly_cents;
  const source: Record<AgentBudget['source'], string> = {
    key: 'You set this budget for the agent.',
    plan_default: "The plan's default: half its default spend cap.",
    org_ceiling: "The organization's ceiling for agents applies.",
    unlimited: 'No limit: changes are never held for cost.',
  };
  if (limit === undefined)
    return {
      amount: `${spent}, no limit`,
      source: source[budget.source] ?? '',
      ratio: undefined,
      tone: 'none',
    };
  // A $0 budget (Free) is full before anything is spent.
  const ratio = limit > 0 ? Math.min(budget.spent_cents / limit, 1) : 1;
  return {
    amount: `${spent} of ${formatCents(limit)}`,
    source: source[budget.source] ?? '',
    ratio,
    tone: ratio >= 1 ? 'critical' : ratio >= 0.8 ? 'warning' : 'good',
  };
}

/**
 * A write request as a sentence, for the paths whose meaning the API contract
 * fixes (api/openapi.yaml). Anything else returns undefined and the row shows
 * the method and path alone, never a guess.
 */
export function activitySentence(entry: Pick<AgentActivityEntry, 'method' | 'path'>) {
  const { method, path } = entry;
  const app = /^\/v1\/apps\/([^/]+)(?:\/([a-z-]+))?$/.exec(path);
  if (path === '/v1/apps' && method === 'POST') return 'Created an app';
  if (app) {
    const [, slug, rest] = app;
    if (!rest) {
      if (method === 'PATCH') return `Changed ${slug}'s settings`;
      if (method === 'DELETE') return `Deleted ${slug}`;
      return undefined;
    }
    if (method !== 'POST') return undefined;
    const actions: Record<string, string> = {
      deployments: `Deployed ${slug}`,
      rollback: `Rolled back ${slug}`,
      scaling: `Changed ${slug}'s scaling`,
      prewarm: `Prewarmed ${slug}`,
      restart: `Restarted ${slug}`,
      restore: `Restored ${slug}`,
    };
    return actions[rest];
  }
  const fixed: Record<string, string> = {
    'POST /v1/crons': 'Added a cron',
    'POST /v1/domains': 'Added a custom domain',
    'POST /v1/postgres/databases': 'Created a database',
  };
  if (fixed[`${method} ${path}`]) return fixed[`${method} ${path}`];
  if (/^\/v1\/crons\/[^/]+$/.test(path))
    return method === 'PATCH'
      ? 'Changed a cron'
      : method === 'DELETE'
        ? 'Deleted a cron'
        : undefined;
  if (/^\/v1\/postgres\/databases\/[^/]+$/.test(path) && method === 'DELETE')
    return 'Deleted a database';
  if (/^\/v1\/deployments\/[^/]+$/.test(path))
    return method === 'PATCH'
      ? "Changed a deployment's warm instances"
      : method === 'DELETE'
        ? 'Deleted a deployment'
        : undefined;
  return undefined;
}

/** How the API answered a write: it went through, or it was refused. */
export function activityOutcome(status: number): { label: string; tone: AgentTone } {
  if (status === 101) return { label: 'Debugger attached', tone: 'none' };
  if (status >= 200 && status < 300) return { label: 'Went through', tone: 'good' };
  if (status >= 500) return { label: `Failed (${status})`, tone: 'critical' };
  return { label: `Refused (${status})`, tone: 'warning' };
}

/** What undoing one change will do, before it is applied. */
export function undoPlanWords(item: Pick<AgentUndoItem, 'status'>): {
  label: string;
  tone: AgentTone;
} {
  switch (item.status) {
    case 'undoable':
      return { label: 'Will be undone', tone: 'good' };
    case 'changed_since':
      return { label: 'Left as it is: changed again since', tone: 'warning' };
    case 'undone':
      return { label: 'Already undone', tone: 'none' };
    default:
      return { label: "Can't be undone", tone: 'none' };
  }
}

/** What an applied undo did to one change. */
export function undoResultWords(item: Pick<AgentUndoItem, 'result' | 'status'>): {
  label: string;
  tone: AgentTone;
} {
  switch (item.result) {
    case 'undone':
      return { label: 'Undone', tone: 'good' };
    case 'failed':
      return { label: 'Could not be undone', tone: 'critical' };
    case 'changed_since':
      return { label: 'Left as it is: changed again since', tone: 'warning' };
    case 'skipped':
      return { label: 'Left as it is', tone: 'none' };
    default:
      return undoPlanWords(item);
  }
}

/** The sentence after an undo is applied. */
export function undoResultSentence(result: { undone: number; failed: number }): string {
  if (result.undone === 0 && result.failed === 0) return 'Nothing was undone.';
  const undone = `${plural(result.undone, 'change')} undone.`;
  return result.failed > 0
    ? `${undone} ${plural(result.failed, 'change')} could not be undone.`
    : undone;
}

/** A capability a company can let its agents have beyond looking. */
export interface PolicyCapability {
  scope: string;
  label: string;
  detail: string;
}

/**
 * apid's api.MCPGrantableScopes (pkg/api/cliauth.go; content/docs/mcp.md),
 * changes first. Looking (`apps:read`) is not the policy's to take away.
 */
export const POLICY_CAPABILITIES: readonly PolicyCapability[] = [
  {
    scope: 'deploy:write',
    label: 'Deploy and change apps',
    detail: 'Deploy, roll back, change app settings and delete apps.',
  },
  {
    scope: 'env:write',
    label: 'Set variables',
    detail: "Change an app's configuration that is not secret.",
  },
  {
    scope: 'secrets:request',
    label: 'Ask a person for a secret',
    detail: 'Opens a page where a person enters the secret. The agent never sees the value.',
  },
  {
    scope: 'storage:manage',
    label: 'Manage buckets',
    detail: 'Create and change object storage buckets.',
  },
  {
    scope: 'postgres:manage',
    label: 'Manage databases',
    detail: 'Create and change PostgreSQL databases.',
  },
  {
    scope: 'usage:read',
    label: 'See usage and costs',
    detail: 'Read what each app used and cost.',
  },
  {
    scope: 'data:read',
    label: 'Read app data',
    detail: 'Database rows, stored objects, and queue and workflow payloads.',
  },
];

const KNOWN_CAPABILITIES = new Set(POLICY_CAPABILITIES.map((c) => c.scope));

/**
 * The capabilities to offer: the ones the console knows, then any other the
 * policy already allows, by its exact name, so a save never drops it unseen.
 */
export function policyCapabilities(allowed: readonly string[]): PolicyCapability[] {
  const unknown = [...new Set(allowed)].filter((scope) => !KNOWN_CAPABILITIES.has(scope));
  return [...POLICY_CAPABILITIES, ...unknown.map((scope) => ({ scope, label: scope, detail: '' }))];
}

/** The actions a company can make every agent ask a person about (docs/agents.md). */
export const POLICY_APPROVALS: readonly { kind: string; label: string; detail: string }[] = [
  { kind: 'delete', label: 'Deleting something', detail: '' },
  {
    kind: 'production',
    label: 'Changing production',
    detail: "Deploys, rollbacks, and a production app's variables, secrets and settings.",
  },
  { kind: 'credentials', label: 'Creating or rotating credentials', detail: '' },
  { kind: 'billing', label: 'Changing billing', detail: '' },
];

type PolicyReach = Pick<AgentPolicy, 'agents_allowed' | 'allowed_scopes'>;

/**
 * Whether a connection with these scopes may no longer act under a policy
 * (apid's ExceedsPolicy). apid revokes such a connection when the policy is
 * saved, so this is the page's preview of that, not the decision.
 */
export function exceedsPolicy(policy: PolicyReach, scopes: readonly string[]): boolean {
  if (!policy.agents_allowed) return true;
  return scopes.some(
    (scope) => KNOWN_CAPABILITIES.has(scope) && !policy.allowed_scopes.includes(scope)
  );
}

/** The connected agents a policy would disconnect. */
export function policyDisconnects(
  policy: PolicyReach,
  connections: readonly AgentConnection[]
): AgentConnection[] {
  return connections.filter((agent) => exceedsPolicy(policy, agent.scopes));
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** "a", "a or b", "a, b or c". */
const orWords = (items: readonly string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;

/** The policy page's opening sentence: may agents act here, and how far. */
export function policyAnswer(
  policy: PolicyReach,
  label: string
): { tone: AgentTone; sentence: string } {
  if (!policy.agents_allowed)
    return { tone: 'none', sentence: `Agents are not allowed in ${label}.` };
  const allowed = POLICY_CAPABILITIES.filter((c) => policy.allowed_scopes.includes(c.scope));
  const held = POLICY_CAPABILITIES.filter((c) => !policy.allowed_scopes.includes(c.scope));
  if (held.length === 0)
    return { tone: 'good', sentence: `Agents may act in ${label}, with every capability.` };
  if (allowed.length === 0)
    return { tone: 'good', sentence: `Agents may only inspect apps in ${label}.` };
  // Name the shorter side, so the sentence stays one line.
  return {
    tone: 'good',
    sentence:
      allowed.length <= held.length
        ? `Agents in ${label} may inspect apps, and ${listWords(allowed.map((c) => lowerFirst(c.label)))}.`
        : `Agents may act in ${label}, but may not ${orWords(held.map((c) => lowerFirst(c.label)))}.`,
  };
}

/** The rest of a policy in a sentence or two: what is asked about, and the ceiling. */
export function policyRules(
  policy: Pick<AgentPolicy, 'approval_categories' | 'max_agent_budget_cents'>
): string {
  const asks = policy.approval_categories ?? [];
  const parts: string[] = [];
  if (asks.length > 0) parts.push(`Every agent asks a person before ${asksBefore(asks)}.`);
  if (policy.max_agent_budget_cents !== undefined)
    parts.push(
      `No agent's always-on budget can pass ${formatCents(policy.max_agent_budget_cents)} a month.`
    );
  return parts.join(' ');
}

/** The policy as a person edits it. */
export interface PolicyDraft {
  allowed: boolean;
  scopes: string[];
  approvals: string[];
  ceiling: 'none' | 'amount';
  /** Dollars a month, as typed. */
  amount: string;
  /** The person's own notification channels, by name. */
  channels: string[];
}

export function policyDraft(policy: AgentPolicy): PolicyDraft {
  const max = policy.max_agent_budget_cents;
  return {
    allowed: policy.agents_allowed,
    scopes: [...policy.allowed_scopes],
    approvals: [...(policy.approval_categories ?? [])],
    ceiling: max === undefined ? 'none' : 'amount',
    amount: max === undefined ? '' : (max / 100).toFixed(2),
    channels: [...(policy.approval_channels ?? [])],
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item) => b.includes(item));

/** In the order the page lists them, whatever order they were ticked in. */
const inOrder = (chosen: readonly string[], order: readonly string[]) => [
  ...order.filter((item) => chosen.includes(item)),
  ...chosen.filter((item) => !order.includes(item)),
];

/**
 * What to send to save a draft, `undefined` when nothing changed, or why it
 * can't be saved. With agents off only the switch is saved: the rest of the
 * policy is kept as it was, ready for when agents are allowed again.
 */
export function policyChange(
  saved: AgentPolicy,
  draft: PolicyDraft
): { change?: AgentPolicyChange; error?: string } {
  if (!draft.allowed)
    return saved.agents_allowed
      ? { change: { agents_allowed: false, allowed_scopes: [...saved.allowed_scopes] } }
      : {};
  const change: AgentPolicyChange = {
    agents_allowed: true,
    allowed_scopes: inOrder(
      draft.scopes,
      POLICY_CAPABILITIES.map((c) => c.scope)
    ),
  };
  let changed = !saved.agents_allowed || !sameSet(change.allowed_scopes, saved.allowed_scopes);
  if (!sameSet(draft.approvals, saved.approval_categories ?? [])) {
    change.approval_categories = inOrder(
      draft.approvals,
      POLICY_APPROVALS.map((a) => a.kind)
    );
    changed = true;
  }
  if (draft.ceiling === 'none') {
    if (saved.max_agent_budget_cents !== undefined) {
      change.clear_max_agent_budget = true;
      changed = true;
    }
  } else {
    const millicents = parseUsdMillicents(draft.amount);
    const cents = millicents === undefined ? undefined : millicents / 1000;
    if (cents === undefined || cents > AGENT_BUDGET_MAX_CENTS)
      return {
        error: `Enter a dollar amount from $0 to ${formatCents(AGENT_BUDGET_MAX_CENTS)}, such as 100 or 12.50.`,
      };
    if (cents !== saved.max_agent_budget_cents) {
      change.max_agent_budget_cents = cents;
      changed = true;
    }
  }
  if (!sameSet(draft.channels, saved.approval_channels ?? [])) {
    change.approval_channels = [...draft.channels];
    changed = true;
  }
  return changed ? { change } : {};
}
