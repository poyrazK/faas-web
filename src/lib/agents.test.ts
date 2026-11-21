import { describe, expect, it } from 'vitest';
import type { AgentBudget, AgentConnection } from '@/lib/api/agents';
import {
  accessLevel,
  activityOutcome,
  activitySentence,
  agentName,
  agentsAnswer,
  approvalSentence,
  asksBefore,
  budgetWords,
  listWords,
  reachWords,
  scopePhrases,
  timeLeft,
  undoPlanWords,
  undoResultSentence,
  undoResultWords,
} from './agents';

const agent = (over: Partial<AgentConnection> = {}): AgentConnection => ({
  id: 'key-1',
  kind: 'hosted_mcp',
  prefix: 'faas_live_a1b2',
  scopes: ['apps:read', 'deploy:write'],
  created_at: '2026-11-15T10:00:00Z',
  ...over,
});

describe('agent names and reach', () => {
  it('prefers the client name, then the label, then the key prefix', () => {
    expect(agentName(agent({ client_name: 'Claude Code', label: 'mcp-login' }))).toBe(
      'Claude Code'
    );
    expect(agentName(agent({ label: 'ci-agent' }))).toBe('ci-agent');
    expect(agentName(agent())).toBe('Agent faas_live_a1b2');
  });

  it('says every project only when the API lists no limit', () => {
    expect(reachWords(agent())).toBe('Every project');
    expect(reachWords(agent({ projects: ['shop', 'tools'] }))).toBe('shop and tools');
    expect(reachWords(agent({ projects: [] }))).toBe('No project');
    expect(reachWords(agent({ kind: 'app_agent' }))).toBe('One app');
  });

  it('joins lists the way a sentence does', () => {
    expect(listWords([])).toBe('');
    expect(listWords(['a'])).toBe('a');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('scopes and approvals', () => {
  it('drops the agent marker and keeps an unknown scope by its name', () => {
    expect(scopePhrases(['agent', 'apps:read', 'future:scope'])).toEqual([
      'inspect apps, deployments, logs and metrics',
      'future:scope',
    ]);
  });

  it('answers whether the agent can change things', () => {
    expect(accessLevel(['agent', 'apps:read', 'usage:read'])).toBe('Read only');
    expect(accessLevel(['apps:read', 'deploy:write'])).toBe('Can make changes');
    expect(accessLevel(['postgres:manage'])).toBe('Can make changes');
    expect(accessLevel(['admin'])).toBe('Full access');
  });

  it('distinguishes asking for nothing from not being told', () => {
    expect(asksBefore(undefined)).toBe('');
    expect(asksBefore([])).toBe('Nothing');
    expect(asksBefore(['delete', 'billing'])).toBe('deletes and billing changes');
  });

  it('names what a request is for, with the agent', () => {
    expect(approvalSentence({ agent: 'Claude Code', category: 'production' })).toBe(
      'Claude Code wants to change production'
    );
    expect(approvalSentence({ agent: '', category: 'budget' })).toBe(
      'An agent wants to go over its monthly budget'
    );
  });

  it('counts down to the expiry and stops at it', () => {
    const now = Date.parse('2026-11-21T12:00:00Z');
    expect(timeLeft('2026-11-21T12:22:30Z', now)).toBe('22 min left');
    expect(timeLeft('2026-11-21T12:00:20Z', now)).toBe('under a minute left');
    expect(timeLeft('2026-11-21T11:59:00Z', now)).toBe('Expired');
    expect(timeLeft('not a time', now)).toBe('');
  });
});

describe('agentsAnswer', () => {
  it('leads with a waiting request', () => {
    expect(agentsAnswer([agent(), agent({ id: 'key-2' })], 1)).toEqual({
      tone: 'warning',
      sentence: '2 agents are connected. 1 request is waiting for your approval.',
    });
  });

  it('says nothing is waiting only once approvals have loaded', () => {
    expect(agentsAnswer([agent()], 0).sentence).toBe(
      '1 agent is connected. Nothing is waiting for you.'
    );
    expect(agentsAnswer([agent()], undefined)).toEqual({
      tone: 'none',
      sentence: '1 agent is connected.',
    });
  });

  it('invites a first connection', () => {
    expect(agentsAnswer([], 0).sentence).toBe(
      'No agents are connected. Connect one to let it deploy and look after your apps.'
    );
  });
});

describe('budgetWords', () => {
  const budget = (over: Partial<AgentBudget>): AgentBudget => ({
    source: 'plan_default',
    spent_cents: 640,
    month: '2026-11',
    monthly_cents: 2500,
    ...over,
  });

  it('shows what is committed against the limit', () => {
    const words = budgetWords(budget({}));
    expect(words.amount).toBe('$6.40 of $25.00');
    expect(words.ratio).toBeCloseTo(0.256);
    expect(words.tone).toBe('good');
  });

  it('warns near the limit and stops at it', () => {
    expect(budgetWords(budget({ spent_cents: 2100 })).tone).toBe('warning');
    const over = budgetWords(budget({ spent_cents: 4000 }));
    expect(over.ratio).toBe(1);
    expect(over.tone).toBe('critical');
  });

  it('treats a $0 budget as used up, not as empty', () => {
    const free = budgetWords(budget({ monthly_cents: 0, spent_cents: 0 }));
    expect(free.amount).toBe('$0.00 of $0.00');
    expect(free.ratio).toBe(1);
  });

  it('has no bar without a limit', () => {
    const words = budgetWords(
      budget({ source: 'unlimited', monthly_cents: undefined, key_unlimited: true })
    );
    expect(words.amount).toBe('$6.40, no limit');
    expect(words.ratio).toBeUndefined();
  });
});

describe('activity', () => {
  it('names the changes the API contract fixes', () => {
    expect(activitySentence({ method: 'POST', path: '/v1/apps' })).toBe('Created an app');
    expect(activitySentence({ method: 'DELETE', path: '/v1/apps/demo' })).toBe('Deleted demo');
    expect(activitySentence({ method: 'PATCH', path: '/v1/apps/api' })).toBe(
      "Changed api's settings"
    );
    expect(activitySentence({ method: 'POST', path: '/v1/apps/api/deployments' })).toBe(
      'Deployed api'
    );
    expect(activitySentence({ method: 'POST', path: '/v1/apps/api/rollback' })).toBe(
      'Rolled back api'
    );
    expect(activitySentence({ method: 'DELETE', path: '/v1/crons/abc' })).toBe('Deleted a cron');
  });

  it('never guesses at a path it does not know', () => {
    expect(activitySentence({ method: 'POST', path: '/v1/apps/api/secrets' })).toBeUndefined();
    expect(activitySentence({ method: 'PUT', path: '/v1/apps/api' })).toBeUndefined();
    expect(activitySentence({ method: 'POST', path: '/v1/something/new' })).toBeUndefined();
  });

  it('separates a change that went through from one that was refused', () => {
    expect(activityOutcome(201)).toEqual({ label: 'Went through', tone: 'good' });
    expect(activityOutcome(409)).toEqual({ label: 'Refused (409)', tone: 'warning' });
    expect(activityOutcome(503)).toEqual({ label: 'Failed (503)', tone: 'critical' });
    expect(activityOutcome(101).label).toBe('Debugger attached');
  });
});

describe('undo', () => {
  it('says what a plan will do to each change', () => {
    expect(undoPlanWords({ status: 'undoable' }).label).toBe('Will be undone');
    expect(undoPlanWords({ status: 'not_undoable' }).label).toBe("Can't be undone");
    expect(undoPlanWords({ status: 'changed_since' }).tone).toBe('warning');
    expect(undoPlanWords({ status: 'undone' }).label).toBe('Already undone');
  });

  it('says what an apply did', () => {
    expect(undoResultWords({ status: 'undone', result: 'undone' }).label).toBe('Undone');
    expect(undoResultWords({ status: 'undoable', result: 'failed' }).tone).toBe('critical');
    expect(undoResultWords({ status: 'not_undoable', result: 'skipped' }).label).toBe(
      'Left as it is'
    );
  });

  it('sums up the result without hiding failures', () => {
    expect(undoResultSentence({ undone: 2, failed: 0 })).toBe('2 changes undone.');
    expect(undoResultSentence({ undone: 1, failed: 1 })).toBe(
      '1 change undone. 1 change could not be undone.'
    );
    expect(undoResultSentence({ undone: 0, failed: 0 })).toBe('Nothing was undone.');
  });
});
