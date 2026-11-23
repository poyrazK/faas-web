import { randomUUID } from 'node:crypto';
import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
type Connection = S['AgentConnectionResponse'];
type Approval = S['AgentApprovalResponse'];
type Budget = S['AgentBudgetResponse'];
type Entry = S['AgentActivityEntry'];
type UndoItem = S['AgentUndoItem'];

/**
 * Connected agents (faas pkg/apid/agentconnections). The personal account has
 * a hosted sign-in, an agent key limited to one project and near its budget,
 * and an app-bound key; Acme Corp has one agent of the signed-in member and
 * one of a colleague, whose budget the member cannot read. MOCK_EMPTY=1
 * starts with none.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ALL_APPROVALS: NonNullable<Connection['approvals']> = [
  'delete',
  'production',
  'credentials',
  'billing',
];

/** Thrown as a problem by the plugin. */
export class AgentProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string
  ) {
    super(detail);
  }
}

const notFound = () =>
  new AgentProblem(404, 'not_found', 'no connected agent with this id acts here');

const CLAUDE = randomUUID();
const CI = randomUUID();
const INSPECTOR = randomUUID();
const ORG_CURSOR = randomUUID();
const ORG_CODEX = randomUUID();

const personal: Connection[] = db.EMPTY
  ? []
  : [
      {
        id: CLAUDE,
        kind: 'hosted_mcp',
        client_name: 'Claude Code',
        client_site: '',
        label: 'mcp-login',
        prefix: 'faas_live_a1b2',
        scopes: ['apps:read', 'deploy:write'],
        created_at: db.iso(6 * DAY),
        last_used_at: db.iso(12 * MIN),
        expires_at: db.iso(-24 * DAY),
        approvals: ALL_APPROVALS,
      },
      {
        id: CI,
        kind: 'agent_key',
        label: 'ci-agent',
        prefix: 'faas_live_c3d4',
        scopes: ['agent', 'apps:read', 'deploy:write', 'env:write'],
        created_at: db.iso(19 * DAY),
        last_used_at: db.iso(3 * HOUR),
        projects: ['acme-shop'],
        approvals: ['delete', 'billing'],
      },
      {
        id: INSPECTOR,
        kind: 'app_agent',
        app_id: db.apps[0]?.id,
        label: 'app-inspector',
        prefix: 'faas_dt',
        scopes: ['agent', 'apps:read', 'usage:read'],
        created_at: db.iso(2 * DAY),
        approvals: ALL_APPROVALS,
      },
    ];

const org: Connection[] = db.EMPTY
  ? []
  : [
      {
        id: ORG_CURSOR,
        kind: 'hosted_mcp',
        client_name: 'Cursor',
        client_site: 'cursor.com',
        label: 'mcp-login',
        prefix: 'faas_live_e5f6',
        scopes: ['apps:read', 'deploy:write'],
        created_at: db.iso(4 * DAY),
        last_used_at: db.iso(40 * MIN),
        expires_at: db.iso(-26 * DAY),
        org_id: db.ORG_ID,
        member: db.account.email,
        approvals: ALL_APPROVALS,
      },
      {
        id: ORG_CODEX,
        kind: 'hosted_mcp',
        client_name: 'Codex',
        client_site: 'chatgpt.com',
        label: 'mcp-login',
        prefix: 'faas_live_g7h8',
        scopes: ['apps:read', 'deploy:write', 'postgres:manage', 'postgres:read'],
        created_at: db.iso(9 * DAY),
        last_used_at: db.iso(2 * DAY),
        expires_at: db.iso(-21 * DAY),
        org_id: db.ORG_ID,
        member: 'poyraz@acme.dev',
        approvals: ALL_APPROVALS,
      },
    ];

const isOrg = (slug: string | undefined) => slug === 'acme-corp';
const listOf = (slug?: string) => (slug ? (isOrg(slug) ? org : []) : personal);

export function list(slug?: string) {
  return { items: [...listOf(slug)].sort((a, b) => b.created_at.localeCompare(a.created_at)) };
}

function find(id: string, slug?: string): Connection {
  const found = listOf(slug).find((c) => c.id === id);
  if (!found) throw notFound();
  return found;
}

export function revoke(id: string, slug?: string) {
  const all = listOf(slug);
  const index = all.findIndex((c) => c.id === id);
  // apid: revoking again succeeds only for an agent it still knows; the mock
  // forgets a revoked one, so a second call is the unknown-id answer.
  if (index < 0) throw notFound();
  all.splice(index, 1);
  for (let i = approvals.length - 1; i >= 0; i--)
    if (approvals[i].connection === id) approvals.splice(i, 1);
}

export function revokeAll(slug?: string) {
  const all = listOf(slug);
  const revoked = all.length;
  for (const c of [...all]) revoke(c.id, slug);
  return { revoked };
}

// --- Approvals: only the pending ones a person may decide are listed. ---

const approvals: (Approval & { connection: string })[] = db.EMPTY
  ? []
  : [
      {
        id: randomUUID(),
        connection: CLAUDE,
        agent: 'Claude Code',
        category: 'production',
        method: 'POST',
        path: `/v1/apps/${db.apps[0]?.slug ?? 'api'}/deployments`,
        body_bound: true,
        status: 'pending',
        reason: 'Deploy the reviewed fix for the 502s on /checkout',
        created_at: db.iso(8 * MIN),
        expires_at: db.iso(-22 * MIN),
      },
      {
        id: randomUUID(),
        connection: CI,
        agent: 'ci-agent',
        category: 'budget',
        method: 'POST',
        path: `/v1/apps/${db.apps[1]?.slug ?? 'worker'}/scaling`,
        body_bound: true,
        status: 'pending',
        reason: 'Keep two instances warm for the launch on Friday',
        created_at: db.iso(21 * MIN),
        expires_at: db.iso(-9 * MIN),
      },
    ];

/** apid's review page: a signed-in person decides there (agent_approval_page.go). */
const reviewUrl = (id: string) => `https://api.gregale.dev/cli-auth?agent_approval=${id}`;

export function listApprovals() {
  const now = Date.now();
  return {
    items: approvals
      .filter((a) => Date.parse(a.expires_at) > now)
      .map(({ connection: _connection, ...a }) => ({ ...a, review_url: reviewUrl(a.id) })),
  };
}

// --- Approval channels (personal account). ---

let approvalChannels: string[] = [];

export const getChannels = () => ({ channels: [...approvalChannels].sort() });

export function setChannels(body: Record<string, unknown>, known: readonly string[]) {
  const names = body.channels;
  if (!Array.isArray(names))
    throw new AgentProblem(
      400,
      'validation',
      'channels is required: the names of your notification channels, or an empty list'
    );
  for (const name of names)
    if (!known.includes(String(name)))
      throw new AgentProblem(404, 'not_found', `no notification channel named ${String(name)}`);
  approvalChannels = names.map(String);
  return getChannels();
}

// --- Budgets (budget.go): plan default is half Pro's default spend cap. ---

const PLAN_DEFAULT_CENTS = 2500;
/** apid's api.MaxAgentBudgetCents. */
const MAX_BUDGET_CENTS = 100_000_000;

const own = new Map<string, { cents?: number; unlimited?: boolean }>([[CI, { cents: 4000 }]]);
const spent = new Map<string, number>([
  [CLAUDE, 640],
  [CI, 3650],
  [ORG_CURSOR, 1180],
]);

/** A member reads only the budget of an agent they connected (budgetConnection). */
function ownConnection(id: string): Connection {
  const found = personal.find((c) => c.id === id) ?? org.find((c) => c.id === id);
  if (!found || (found.member && found.member !== db.account.email)) throw notFound();
  return found;
}

export function budget(id: string): Budget {
  ownConnection(id);
  const set = own.get(id);
  const base = {
    spent_cents: spent.get(id) ?? 0,
    month: new Date().toISOString().slice(0, 7),
  };
  if (set?.unlimited) return { ...base, source: 'unlimited', key_unlimited: true };
  if (set?.cents !== undefined)
    return { ...base, source: 'key', monthly_cents: set.cents, key_monthly_cents: set.cents };
  return { ...base, source: 'plan_default', monthly_cents: PLAN_DEFAULT_CENTS };
}

export function setBudget(id: string, body: Record<string, unknown>): Budget {
  ownConnection(id);
  const cents = body.monthly_cents;
  const chosen = [cents !== undefined, body.unlimited === true, body.default === true].filter(
    Boolean
  ).length;
  if (chosen !== 1)
    throw new AgentProblem(
      400,
      'validation',
      'set exactly one of monthly_cents, unlimited or default'
    );
  if (body.default === true) own.delete(id);
  else if (body.unlimited === true) own.set(id, { unlimited: true });
  else {
    const value = Number(cents);
    if (!Number.isInteger(value) || value < 0 || value > MAX_BUDGET_CENTS)
      throw new AgentProblem(400, 'validation', 'monthly_cents must be between 0 and the maximum');
    own.set(id, { cents: value });
  }
  return budget(id);
}

// --- Activity and undo. ---

interface Change extends Entry {
  kind: UndoItem['kind'];
  summary: string;
  /** Why undo leaves it, when it does. */
  blocked?: { status: 'not_undoable' | 'changed_since'; reason: string };
  undone?: boolean;
}

const slug0 = db.apps[0]?.slug ?? 'api';
const slug1 = db.apps[1]?.slug ?? 'worker';

function change(
  ago: number,
  method: Entry['method'],
  path: string,
  status: number,
  kind: Change['kind'],
  summary: string,
  extra: Partial<Change> = {}
): Change {
  return {
    id: randomUUID(),
    method,
    path,
    status,
    created_at: db.iso(ago),
    kind,
    summary,
    ...extra,
  };
}

const activity = new Map<string, Change[]>(
  db.EMPTY
    ? []
    : [
        [
          CLAUDE,
          [
            change(
              12 * MIN,
              'PATCH',
              `/v1/apps/${slug0}`,
              200,
              'settings',
              `${slug0}: min_instances 0 → 1`,
              {
                reason: 'Keep one instance warm so the first checkout request is not a cold wake',
              }
            ),
            change(
              50 * MIN,
              'POST',
              `/v1/apps/${slug0}/deployments`,
              201,
              'deploy',
              `${slug0}: deployed a new release`,
              {
                reason: 'Ship the retry fix for the payment webhook',
                approval_id: randomUUID(),
              }
            ),
            change(3 * HOUR, 'POST', '/v1/crons', 201, 'create', 'cron nightly-report created'),
            change(
              5 * HOUR,
              'POST',
              `/v1/apps/${slug0}/secrets`,
              200,
              'other',
              `${slug0}: secret STRIPE_KEY set`,
              {
                blocked: {
                  status: 'not_undoable',
                  reason: 'Gregale keeps no copy of a replaced secret; set it again.',
                },
              }
            ),
            change(
              9 * HOUR,
              'POST',
              `/v1/apps/${slug1}/scaling`,
              409,
              'settings',
              `${slug1}: scaling change refused`
            ),
            change(
              26 * HOUR,
              'PATCH',
              `/v1/apps/${slug1}`,
              200,
              'settings',
              `${slug1}: idle_timeout_s 60 → 300`,
              {
                blocked: {
                  status: 'changed_since',
                  reason: 'Someone changed this setting again after the agent did.',
                },
              }
            ),
            change(3 * DAY, 'DELETE', '/v1/apps/old-demo', 204, 'delete', 'app old-demo deleted', {
              reason: 'Remove the demo app we replaced with the shop API',
              approval_id: randomUUID(),
            }),
          ],
        ],
        [
          CI,
          [
            change(
              3 * HOUR,
              'POST',
              `/v1/apps/${slug1}/deployments`,
              201,
              'deploy',
              `${slug1}: deployed a new release`
            ),
            change(
              27 * HOUR,
              'POST',
              `/v1/apps/${slug1}/deployments`,
              201,
              'deploy',
              `${slug1}: deployed a new release`
            ),
          ],
        ],
        [
          ORG_CURSOR,
          [
            change(
              40 * MIN,
              'POST',
              `/v1/apps/${slug0}/rollback`,
              200,
              'deploy',
              `${slug0}: rolled back`
            ),
          ],
        ],
      ]
);

export function listActivity(id: string, query: URLSearchParams, slug?: string) {
  find(id, slug);
  const rows = activity.get(id) ?? [];
  const limit = Math.min(Math.max(Number(query.get('limit')) || 50, 1), 200);
  const before = query.get('before');
  const start = before ? rows.findIndex((r) => `${r.created_at}_${r.id}` === before) + 1 : 0;
  const page = rows.slice(start, start + limit);
  const last = page[page.length - 1];
  return {
    activity: page.map(
      ({ kind: _kind, summary: _summary, blocked: _blocked, undone: _undone, ...e }) => e
    ),
    ...(start + limit < rows.length && last
      ? { next_before: `${last.created_at}_${last.id}` }
      : {}),
  };
}

function selected(id: string, body: Record<string, unknown>): { since: string; rows: Change[] } {
  const rows = (activity.get(id) ?? []).filter((r) => r.status >= 200 && r.status < 300);
  const entries = Array.isArray(body.entries) ? body.entries.map(String) : undefined;
  const sinceMs =
    typeof body.since === 'string' && Number.isFinite(Date.parse(body.since))
      ? Date.parse(body.since)
      : Date.now() - DAY;
  if (sinceMs < Date.now() - 7 * DAY - MIN)
    throw new AgentProblem(422, 'validation', 'since is at most 7 days ago');
  const chosen = entries
    ? rows.filter((r) => entries.includes(r.id))
    : rows.filter((r) => Date.parse(r.created_at) >= sinceMs);
  return { since: new Date(sinceMs).toISOString(), rows: chosen };
}

function planItem(row: Change, force: boolean): UndoItem {
  const base = {
    activity_id: row.id,
    method: row.method,
    path: row.path,
    kind: row.kind,
    summary: row.summary,
    created_at: row.created_at,
  };
  if (row.undone) return { ...base, status: 'undone' };
  if (row.blocked && !(force && row.blocked.status === 'changed_since'))
    return { ...base, status: row.blocked.status, reason: row.blocked.reason };
  return { ...base, status: 'undoable' };
}

const digest = (items: UndoItem[]) =>
  `sha256:${Buffer.from(items.map((i) => `${i.activity_id}:${i.status}`).join('|'))
    .toString('hex')
    .slice(0, 40)}`;

export function planUndo(id: string, body: Record<string, unknown>, slug?: string) {
  find(id, slug);
  const { since, rows } = selected(id, body);
  const items = rows.map((row) => planItem(row, body.force === true));
  return {
    since,
    items,
    undoable: items.filter((i) => i.status === 'undoable').length,
    plan_digest: digest(items),
  };
}

export function applyUndo(id: string, body: Record<string, unknown>, slug?: string) {
  const plan = planUndo(id, body, slug);
  if (body.plan_digest !== plan.plan_digest)
    throw new AgentProblem(
      409,
      'conflict',
      'the changes or their state differ from the plan; plan the undo again'
    );
  const rows = activity.get(id) ?? [];
  const items = plan.items.map((item): UndoItem => {
    if (item.status !== 'undoable')
      return { ...item, result: item.status === 'changed_since' ? 'changed_since' : 'skipped' };
    const row = rows.find((r) => r.id === item.activity_id);
    if (row) row.undone = true;
    return { ...item, status: 'undone', result: 'undone' };
  });
  return { items, undone: items.filter((i) => i.result === 'undone').length, failed: 0 };
}
