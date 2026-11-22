import { describe, expect, it } from 'vitest';
import type { AgentBudget, AgentConnection, AgentPolicy } from '@/lib/api/agents';
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
  POLICY_CAPABILITIES,
  policyAnswer,
  policyCapabilities,
  policyChange,
  policyDisconnects,
  policyDraft,
  policyRules,
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

describe('organization agent policy', () => {
  const EVERY = POLICY_CAPABILITIES.map((c) => c.scope);
  const policy = (over: Partial<AgentPolicy> = {}): AgentPolicy => ({
    agents_allowed: true,
    allowed_scopes: EVERY,
    approval_categories: [],
    approval_channels: [],
    ...over,
  });

  it('offers the seven capabilities apid grants, and keeps one it does not know', () => {
    expect(EVERY).toEqual([
      'deploy:write',
      'env:write',
      'secrets:request',
      'storage:manage',
      'postgres:manage',
      'usage:read',
      'data:read',
    ]);
    expect(policyCapabilities(['deploy:write', 'future:scope']).at(-1)).toEqual({
      scope: 'future:scope',
      label: 'future:scope',
      detail: '',
    });
  });

  it('answers whether agents may act, naming the shorter side', () => {
    expect(policyAnswer(policy(), 'Acme')).toEqual({
      tone: 'good',
      sentence: 'Agents may act in Acme, with every capability.',
    });
    expect(policyAnswer(policy({ agents_allowed: false }), 'Acme')).toEqual({
      tone: 'none',
      sentence: 'Agents are not allowed in Acme.',
    });
    expect(policyAnswer(policy({ allowed_scopes: [] }), 'Acme').sentence).toBe(
      'Agents may only inspect apps in Acme.'
    );
    expect(policyAnswer(policy({ allowed_scopes: ['deploy:write'] }), 'Acme').sentence).toBe(
      'Agents in Acme may inspect apps, and deploy and change apps.'
    );
    expect(
      policyAnswer(
        policy({
          allowed_scopes: EVERY.filter((s) => !['postgres:manage', 'data:read'].includes(s)),
        }),
        'Acme'
      ).sentence
    ).toBe('Agents may act in Acme, but may not manage databases or read app data.');
  });

  it('sums up the approvals and the ceiling, and says nothing without them', () => {
    expect(policyRules(policy())).toBe('');
    expect(
      policyRules(
        policy({ approval_categories: ['delete', 'production'], max_agent_budget_cents: 10000 })
      )
    ).toBe(
      "Every agent asks a person before deletes and production changes. No agent's always-on budget can pass $100.00 a month."
    );
  });

  it('previews the agents a stricter policy disconnects, as apid decides it', () => {
    const cursor = agent({ id: 'cursor', scopes: ['apps:read', 'deploy:write'] });
    const codex = agent({
      id: 'codex',
      scopes: ['apps:read', 'deploy:write', 'postgres:manage', 'postgres:read'],
    });
    const reader = agent({ id: 'reader', scopes: ['agent', 'apps:read'] });
    const all = [cursor, codex, reader];
    expect(policyDisconnects(policy(), all)).toEqual([]);
    expect(policyDisconnects(policy({ allowed_scopes: ['deploy:write'] }), all)).toEqual([codex]);
    // A read-only agent carries nothing a policy can take away.
    expect(policyDisconnects(policy({ allowed_scopes: [] }), all)).toEqual([cursor, codex]);
    expect(policyDisconnects(policy({ agents_allowed: false }), all)).toEqual(all);
  });

  it('sends nothing when nothing changed', () => {
    const saved = policy({ approval_categories: ['delete'], max_agent_budget_cents: 5000 });
    expect(policyChange(saved, policyDraft(saved))).toEqual({});
  });

  it('sends only what changed beside the two required fields', () => {
    const saved = policy();
    const draft = policyDraft(saved);
    expect(
      policyChange(saved, {
        ...draft,
        scopes: ['data:read', 'deploy:write'],
        approvals: ['billing', 'delete'],
      })
    ).toEqual({
      change: {
        agents_allowed: true,
        allowed_scopes: ['deploy:write', 'data:read'],
        approval_categories: ['delete', 'billing'],
      },
    });
    expect(policyChange(saved, { ...draft, channels: ['ops-slack'] }).change).toEqual({
      agents_allowed: true,
      allowed_scopes: EVERY,
      approval_channels: ['ops-slack'],
    });
  });

  it('sets a ceiling in whole cents, clears it, and refuses what is not money', () => {
    const saved = policy();
    const draft = policyDraft(saved);
    expect(
      policyChange(saved, { ...draft, ceiling: 'amount', amount: '12.50' }).change
    ).toMatchObject({ max_agent_budget_cents: 1250 });
    expect(policyChange(saved, { ...draft, ceiling: 'amount', amount: 'lots' }).error).toMatch(
      /Enter a dollar amount/
    );
    const capped = policy({ max_agent_budget_cents: 5000 });
    expect(policyDraft(capped)).toMatchObject({ ceiling: 'amount', amount: '50.00' });
    expect(policyChange(capped, { ...policyDraft(capped), ceiling: 'none' }).change).toEqual({
      agents_allowed: true,
      allowed_scopes: EVERY,
      clear_max_agent_budget: true,
    });
  });

  it('turns agents off without touching the rest of the policy', () => {
    const saved = policy({ allowed_scopes: ['deploy:write', 'future:scope'] });
    expect(
      policyChange(saved, { ...policyDraft(saved), allowed: false, scopes: [], amount: 'x' })
    ).toEqual({
      change: { agents_allowed: false, allowed_scopes: ['deploy:write', 'future:scope'] },
    });
    const off = policy({ agents_allowed: false });
    expect(policyChange(off, policyDraft(off))).toEqual({});
    // Turning them back on keeps a scope the console does not know.
    expect(
      policyChange(off, { ...policyDraft(saved), allowed: true }).change?.allowed_scopes
    ).toEqual(['deploy:write', 'future:scope']);
  });
});
