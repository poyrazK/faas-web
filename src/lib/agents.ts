import type {
  AgentActivityEntry,
  AgentApproval,
  AgentBudget,
  AgentConnection,
  AgentUndoItem,
} from '@/lib/api/agents';
import { formatCents } from '@/lib/money';

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
  'storage:manage': 'manage buckets',
  'storage:read': 'read buckets',
  'postgres:manage': 'manage databases',
  'postgres:read': 'read database settings',
  'usage:read': 'see usage and costs',
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
