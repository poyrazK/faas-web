import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EdgeRule } from '@/lib/api/queries';
import { KINDS } from './kinds';

/**
 * The kinds the dialog could not make before (waf, retry, circuit_breaker,
 * async, respond), the match condition, log mode and the rule's details.
 */

const state = vi.hoisted(() => ({
  released: new Set<string>([
    'edge-protection',
    'edge-waf-blocking',
    'request-retry',
    'circuit-breaking',
    'async-routes',
    'edge-rule-lists',
  ]),
  plan: 'pro',
  create: vi.fn(),
  update: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({
  useCreateEdgeRule: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateEdgeRule: () => ({ mutateAsync: state.update, isPending: false }),
  useThrottleSuggestions: () => ({ data: undefined, isPending: false, error: null }),
  useWebhooks: () => ({
    data: [
      { id: '6f1c2e9a-0000-4000-8000-000000000001', target_url: 'https://hooks.example.com/done' },
    ],
    isPending: false,
    error: null,
  }),
}));
vi.mock('@/lib/api/edge-rules', async (original) => ({
  ...(await original<typeof import('@/lib/api/edge-rules')>()),
  useEdgeRuleLists: () => ({
    data: {
      lists: [
        { id: 'l1', name: 'office-ips', kind: 'ip', item_count: 3, referenced_by: [] },
        { id: 'l2', name: 'blocked', kind: 'country', item_count: 2, referenced_by: [] },
      ],
    },
    isPending: false,
    error: null,
  }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct', plan: state.plan } }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: () => ({ accountId: 'acct', state: 'unknown', refresh: vi.fn() }),
  useCapabilityAccess: (key: string) => ({ access: state.released.has(key) ? 'on' : 'off' }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/dashboard/plans">{children}</a>,
}));

const { EdgeRuleDialog } = await import('./dialog');

function mount(
  rule: EdgeRule | null = null,
  apps: { slug: string; preview_of_slug?: string }[] = [{ slug: 'api' }]
) {
  return render(
    <EdgeRuleDialog open onClose={vi.fn()} rule={rule} slug="api" apps={apps} nextPriority={10} />
  );
}

const created = () => state.create.mock.calls[0][0] as Record<string, unknown>;
const create = () => userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
// These regression cases exercise the complete technical configuration.
const pick = async (name: RegExp) => {
  await userEvent.click(screen.getByRole('button', { name }));
  await userEvent.click(screen.getByRole('button', { name: /Advanced settings/ }));
};

beforeEach(() => {
  state.released = new Set([
    'edge-protection',
    'edge-waf-blocking',
    'request-retry',
    'circuit-breaking',
    'async-routes',
    'edge-rule-lists',
  ]);
  state.plan = 'pro';
  state.create.mockReset().mockResolvedValue({});
  state.update.mockReset().mockResolvedValue({});
  state.toast.mockReset();
});

describe('waf', () => {
  it('creates a blocking WAF rule with an excluded CRS rule', async () => {
    mount();
    await pick(/Detect suspicious requests/);
    await userEvent.click(screen.getByRole('button', { name: 'Block' }));
    await userEvent.type(screen.getByLabelText(/^Excluded CRS rules/), '942100{enter}');
    await create();
    await waitFor(() => expect(state.create).toHaveBeenCalled());
    expect(created()).toMatchObject({
      kind: 'waf',
      action: {
        mode: 'block',
        paranoia_level: 1,
        anomaly_threshold: 5,
        exclude_rule_ids: [942100],
        inspect_body_bytes: 8192,
      },
    });
  });

  it('offers observe alone while warn and block are not released', async () => {
    state.released.delete('edge-waf-blocking');
    mount();
    await pick(/Detect suspicious requests/);
    expect(screen.queryByRole('button', { name: 'Block' })).toBeNull();
    expect(screen.getByText(/not released to this account yet/)).toBeInTheDocument();
  });

  it('is Pro and Scale only', () => {
    state.plan = 'hobby';
    mount();
    const waf = screen.getByRole('button', { name: /Detect suspicious requests/ });
    expect(waf).toHaveAttribute('aria-disabled', 'true');
    expect(waf).toHaveTextContent('Needs the Pro plan or above.');
  });
});

describe('retry and circuit_breaker', () => {
  it('are offered only once released to the account', () => {
    state.released.delete('request-retry');
    state.released.delete('circuit-breaking');
    mount();
    for (const name of [/Retry connection failures/, /Avoid failing instances/]) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveTextContent('Not released to this account yet.');
    }
  });

  it('creates a retry rule that replays POST with an idempotency key', async () => {
    mount();
    await pick(/Retry connection failures/);
    await userEvent.click(screen.getByRole('switch', { name: 'Replay POST and PATCH' }));
    await create();
    await waitFor(() => expect(state.create).toHaveBeenCalled());
    expect(created()).toMatchObject({
      kind: 'retry',
      action: { max_attempts: 2, allow_non_idempotent: true, budget_percent: 10 },
    });
  });

  it('refuses a breaker whose longest open is under its first open', async () => {
    mount();
    await pick(/Avoid failing instances/);
    const first = screen.getByLabelText(/^First open \(seconds\)/);
    await userEvent.clear(first);
    await userEvent.type(first, '120');
    await create();
    expect(
      screen.getByText('From the first open interval up to 3600 seconds.')
    ).toBeInTheDocument();
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe('async', () => {
  it('is not on the free plan', () => {
    state.plan = 'free';
    mount();
    expect(
      screen.getByRole('button', { name: /Run requests in the background/ })
    ).toHaveTextContent('Not on the free plan.');
  });

  it('sends terminal outcomes to an app webhook and caps attempts', async () => {
    mount();
    await pick(/Run requests in the background/);
    await userEvent.selectOptions(
      screen.getByLabelText(/^On success/),
      '6f1c2e9a-0000-4000-8000-000000000001'
    );
    await userEvent.type(screen.getByLabelText(/^Attempts/), '5');
    await create();
    await waitFor(() => expect(state.create).toHaveBeenCalled());
    expect(created()).toMatchObject({
      kind: 'async',
      action: {
        on_success: '6f1c2e9a-0000-4000-8000-000000000001',
        retry_policy: { max_attempts: 5 },
      },
    });
  });
});

describe('respond', () => {
  it('is offered on preview apps only', () => {
    mount();
    expect(screen.getByRole('button', { name: /Return a fixed response/ })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
  });

  it('answers with a fixed JSON body on a preview app', async () => {
    mount(null, [{ slug: 'api', preview_of_slug: 'shop' }]);
    await pick(/Return a fixed response/);
    const body = screen.getByLabelText(/^Body/);
    await userEvent.clear(body);
    await userEvent.type(body, '{{"id": "demo"}');
    await userEvent.tab();
    await create();
    await waitFor(() => expect(state.create).toHaveBeenCalled());
    expect(created()).toMatchObject({
      kind: 'respond',
      action: { status_code: 200, body: { id: 'demo' } },
    });
  });

  it('refuses a body that does not parse', async () => {
    mount(null, [{ slug: 'api', preview_of_slug: 'shop' }]);
    await pick(/Return a fixed response/);
    const body = screen.getByLabelText(/^Body/);
    await userEvent.clear(body);
    await userEvent.type(body, '{{nope');
    await userEvent.tab();
    await create();
    expect(state.create).not.toHaveBeenCalled();
  });
});

describe('match conditions', () => {
  it('adds an all-of condition with a negated list leaf', async () => {
    mount();
    await pick(/Change a request’s path/);
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.selectOptions(screen.getByLabelText('Condition 1 field'), 'country');
    await userEvent.selectOptions(screen.getByLabelText('Condition 1 operator'), 'in');
    await userEvent.type(screen.getByLabelText('Condition 1 values'), 'US,CA');
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.click(screen.getByRole('button', { name: 'Condition 2 negated' }));
    await userEvent.selectOptions(screen.getByLabelText('Condition 2 field'), 'client_ip');
    await userEvent.selectOptions(screen.getByLabelText('Condition 2 operator'), 'in_list');
    await userEvent.selectOptions(screen.getByLabelText('Condition 2 list'), 'office-ips');
    await create();
    await waitFor(() => expect(state.create).toHaveBeenCalled());
    expect(created().match).toEqual({
      all: [
        { field: 'country', op: 'in', values: ['US', 'CA'] },
        { not: { field: 'client_ip', op: 'in_list', list: 'office-ips' } },
      ],
    });
  });

  it('offers only the lists whose kind fits the field', async () => {
    mount();
    await pick(/Change a request’s path/);
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.selectOptions(screen.getByLabelText('Condition 1 field'), 'country');
    await userEvent.selectOptions(screen.getByLabelText('Condition 1 operator'), 'in_list');
    const options = [...screen.getByLabelText('Condition 1 list').querySelectorAll('option')].map(
      (o) => o.textContent
    );
    expect(options).toEqual(['Pick a list…', 'blocked (2)']);
  });

  it('names the condition that needs a header name', async () => {
    mount();
    await pick(/Change a request’s path/);
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.selectOptions(screen.getByLabelText('Condition 1 field'), 'header');
    await create();
    expect(screen.getByText('Name the header.')).toBeInTheDocument();
    expect(state.create).not.toHaveBeenCalled();
  });

  const nested: EdgeRule = {
    id: 'r1',
    account_id: 'acct',
    app_id: 'app-1',
    kind: 'rewrite',
    match_host: '@app',
    match_path: '/**',
    match_methods: [],
    match_headers: {},
    priority: 10,
    enabled: true,
    action: { from: '/a', to: '/b' },
    match: {
      all: [
        { any: [{ field: 'path', op: 'prefix', values: ['/a'] }] },
        { field: 'method', op: 'eq', value: 'GET' },
      ],
    },
    created_at: '2026-10-10T00:00:00Z',
    updated_at: '2026-10-10T00:00:00Z',
  };

  it('shows a nested condition as JSON and leaves it alone when unchanged', async () => {
    mount(nested);
    expect(screen.getByLabelText(/^Condition \(JSON\)/)).toHaveValue(
      JSON.stringify(nested.match, null, 2)
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(state.update).toHaveBeenCalled());
    const body = state.update.mock.calls[0][0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('match');
    expect(body).not.toHaveProperty('clear_match');
  });

  it('clears a removed condition with clear_match', async () => {
    mount({ ...nested, match: { field: 'verified_bot', op: 'missing' } });
    await userEvent.click(screen.getByRole('button', { name: 'Remove condition 1' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(state.update).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'r1', clear_match: true })
      )
    );
  });
});

describe('match selectors', () => {
  it('takes @app, the host recipes use, and refuses an OpenAPI template path', async () => {
    mount();
    await pick(/Change a request’s path/);
    const host = screen.getByLabelText(/^Host/);
    await userEvent.clear(host);
    await userEvent.type(host, '@app');
    const path = screen.getByLabelText(/^Path/);
    await userEvent.clear(path);
    await userEvent.type(path, '/users/{{id}');
    await create();
    expect(screen.queryByText(/A hostname, @app, or a glob/)).toBeNull();
    expect(screen.getByText(/A glob, not a template/)).toBeInTheDocument();
    await userEvent.clear(path);
    await userEvent.type(path, '/users/?*');
    await create();
    await waitFor(() => expect(state.create).toHaveBeenCalled());
    expect(created()).toMatchObject({ match_host: '@app', match_path: '/users/?*' });
  });
});

describe('rule details', () => {
  it('starts a named rule in log mode with header selectors', async () => {
    mount();
    await pick(/Change a request’s path/);
    await userEvent.type(screen.getByLabelText(/^Name/), 'legacy api');
    await userEvent.click(screen.getByRole('button', { name: 'Log only' }));
    await userEvent.type(screen.getByPlaceholderText('x-tenant'), 'x-beta');
    await userEvent.type(screen.getByPlaceholderText('acme'), '1');
    await userEvent.click(screen.getByRole('button', { name: 'Add pair' }));
    await create();
    await waitFor(() => expect(state.create).toHaveBeenCalled());
    expect(created()).toMatchObject({
      name: 'legacy api',
      mode: 'log',
      match_headers: { 'x-beta': '1' },
    });
  });

  it('switches a log-mode rule to enforce, sending only what changed', async () => {
    mount({
      id: 'r2',
      account_id: 'acct',
      app_id: 'app-1',
      kind: 'ip',
      match_host: '@app',
      match_path: '/**',
      match_methods: [],
      match_headers: {},
      priority: 10,
      enabled: true,
      mode: 'log',
      name: 'Block unverified bots',
      action: { deny: ['0.0.0.0/0', '::/0'] },
      created_at: '2026-10-10T00:00:00Z',
      updated_at: '2026-10-10T00:00:00Z',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Enforce' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(state.update).toHaveBeenCalled());
    const body = state.update.mock.calls[0][0] as Record<string, unknown>;
    expect(body).toMatchObject({ id: 'r2', mode: 'enforce' });
    expect(body).not.toHaveProperty('name');
    expect(body).not.toHaveProperty('match_headers');
  });
});

describe('summaries', () => {
  it('says what each new kind does in one line', () => {
    expect(KINDS.waf.summary({ mode: 'block', exclude_rule_ids: [942100] })).toBe(
      'block · paranoia 1 · threshold 5 · 1 excluded'
    );
    expect(KINDS.retry.summary({ max_attempts: 3 })).toBe('3 attempts · budget 10%');
    expect(KINDS.circuit_breaker.summary({ failure_threshold: 0.25, min_requests: 20 })).toBe(
      '25% of 20 in 10 s · open 5–60 s'
    );
    expect(KINDS.async.summary({ max_age_seconds: 3600 })).toBe('202 accepted · max age 3600 s');
    expect(KINDS.respond.summary({ status_code: 404 })).toBe('404 · empty');
  });
});

describe('plain-English creation', () => {
  const advanced = () => userEvent.click(screen.getByRole('button', { name: /Advanced settings/ }));

  it('creates a route from its destination without exposing technical fields', async () => {
    mount(null, [{ slug: 'api' }, { slug: 'billing' }]);
    await userEvent.click(screen.getByRole('button', { name: /Send requests to another app/ }));
    expect(screen.queryByLabelText(/^Host/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Priority/)).not.toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /^Send requests to/ }),
      'billing'
    );
    expect(screen.getByRole('region', { name: 'Rule preview' })).toHaveTextContent(
      'Sends requests on api to billing.'
    );
    await create();
    expect(created()).toMatchObject({
      kind: 'route',
      match_host: '@app',
      match_path: '/**',
      priority: 10,
      action: { target_app_slug: 'billing' },
    });
  });

  it('uses country names while saving codes and lets the rule start in log-only mode', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Allow or block countries/ }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^Add a country/ }), 'TR');
    expect(screen.getByRole('button', { name: 'Remove Turkey' })).toBeInTheDocument();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /^When this rule is created/ }),
      'log'
    );
    expect(screen.getByRole('region', { name: 'Rule preview' })).toHaveTextContent(
      'Log only. Would block requests from Turkey.'
    );
    await create();
    expect(created()).toMatchObject({
      kind: 'geo',
      mode: 'log',
      action: { deny: ['TR'], allow: [] },
    });
  });

  it('keeps custom conditions and action options when moving between simple and advanced', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Retry connection failures/ }));
    await advanced();
    const backoff = screen.getByLabelText(/^Backoff/);
    await userEvent.clear(backoff);
    await userEvent.type(backoff, '100');
    const path = screen.getByLabelText(/^Path/);
    await userEvent.clear(path);
    await userEvent.type(path, '/orders/**');
    await userEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await userEvent.selectOptions(screen.getByLabelText('Condition 1 field'), 'country');
    await userEvent.selectOptions(screen.getByLabelText('Condition 1 operator'), 'in');
    await userEvent.type(screen.getByLabelText('Condition 1 values'), 'TR');
    await advanced();
    expect(screen.queryByLabelText(/^Backoff/)).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Rule preview' })).toHaveTextContent('Turkey');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: /^How many tries/ }), '3');
    await create();
    expect(created()).toMatchObject({
      match_path: '/orders/**',
      match: { field: 'country', op: 'in', values: ['TR'] },
      action: { max_attempts: 3, backoff_ms: 100 },
    });
  });

  it('opens advanced settings to reveal an invalid hidden field without sending a request', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Avoid failing instances/ }));
    await advanced();
    const first = screen.getByLabelText(/^First open/);
    await userEvent.clear(first);
    await userEvent.type(first, '120');
    await advanced();
    await create();
    expect(screen.getByRole('button', { name: /Advanced settings/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    expect(screen.getByText('From the first open interval up to 3600 seconds.')).toBeVisible();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('can search using technical vocabulary without changing the outcome labels', async () => {
    mount();
    await userEvent.type(screen.getByLabelText('Find an action'), 'cors');
    expect(
      screen.getByRole('button', { name: /Allow calls from another website/ })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Allow or block countries/ })
    ).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Find an action'));
    await userEvent.type(screen.getByLabelText('Find an action'), 'no-such-action');
    expect(screen.getByText(/No actions match/)).toHaveAttribute('role', 'status');
  });
});

it('keeps incomplete country selection in the simple view', async () => {
  mount();
  await userEvent.click(screen.getByRole('button', { name: /Allow or block countries/ }));
  await create();
  expect(screen.getByRole('alert')).toHaveTextContent('Add at least one country.');
  expect(screen.getByRole('button', { name: /Advanced settings/ })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  expect(state.create).not.toHaveBeenCalled();
});

it('retains malformed JSON and refuses to collapse or save it', async () => {
  mount();
  await pick(/Check incoming JSON data/);
  const schema = screen.getByLabelText(/^JSON Schema/);
  await userEvent.clear(schema);
  await userEvent.type(schema, '{{}broken');
  await userEvent.click(screen.getByRole('button', { name: /Advanced settings/ }));
  expect(schema).toHaveValue('{}broken');
  expect(screen.getByRole('button', { name: /Advanced settings/ })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await create();
  expect(state.create).not.toHaveBeenCalled();
  expect(screen.getByText(/Correct the JSON before continuing/)).toBeVisible();
});
