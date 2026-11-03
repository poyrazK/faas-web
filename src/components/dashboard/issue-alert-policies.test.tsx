import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import { IssueAlertPolicies, parseEnvironments, ruleErrors, seconds } from './issue-alert-policies';

const ISSUE = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const rule = {
  key: 'production-burst',
  enabled: true,
  environment: 'production',
  minimum_events: 50,
  window_seconds: 300,
  cooldown_seconds: 1800,
};

let puts: Record<string, unknown[]>;
function api(extra: Handlers = {}) {
  const record = (name: string) => (init: { body?: unknown }) => {
    (puts[name] ??= []).push(init.body);
    return init.body;
  };
  return routeApi({
    'GET /v1/apps/{slug}/issues': () => ({
      items: [{ id: ISSUE, title: 'PaymentError', environment: 'production' }],
    }),
    'GET /v1/apps/{slug}/issue-impact-alert-policy': () => ({
      enabled: true,
      minimum_customers: 3,
      window_seconds: 86400,
    }),
    'PUT /v1/apps/{slug}/issue-impact-alert-policy': ({ body }) => {
      record('impact')({ body });
      const n = (body as { minimum_customers: number }).minimum_customers;
      return { enabled: n > 0, minimum_customers: n, window_seconds: 86400 };
    },
    'GET /v1/apps/{slug}/issue-frequency-alert-policy': () => ({ revision: 4, rules: [rule] }),
    'PUT /v1/apps/{slug}/issue-frequency-alert-policy': ({ body }) => {
      record('frequency')({ body });
      return { revision: 5, rules: (body as { rules: unknown[] }).rules };
    },
    'GET /v1/apps/{slug}/issue-lifecycle-alert-policy': () => ({
      revision: 0,
      environments: [],
      cooldown_seconds: 0,
    }),
    'PUT /v1/apps/{slug}/issue-lifecycle-alert-policy': ({ body }) => {
      record('lifecycle')({ body });
      return { revision: 1, ...(body as object), expected_revision: undefined };
    },
    'POST /v1/apps/{slug}/issue-lifecycle-alert-policy/preview': ({ body }) => {
      record('lifecyclePreview')({ body });
      return {
        issue_id: ISSUE,
        event: 'regressed',
        environment: 'production',
        policy_revision: 0,
        allowed: false,
        reason: 'cooldown',
        next_eligible_at: '2026-11-03T13:00:00Z',
      };
    },
    'GET /v1/apps/{slug}/issue-compound-alert-policy': () => ({ revision: 0, rules: [] }),
    'PUT /v1/apps/{slug}/issue-compound-alert-policy': ({ body }) => {
      record('compound')({ body });
      return { revision: 1, rules: (body as { rules: unknown[] }).rules };
    },
    'POST /v1/apps/{slug}/issue-compound-alert-policy/preview': ({ body }) => {
      record('compoundPreview')({ body });
      return {
        issue_id: ISSUE,
        rule_key: 'rule-1',
        environment: 'production',
        policy_revision: 0,
        window_start: '2026-11-03T11:50:00Z',
        window_end: '2026-11-03T12:00:00Z',
        observed_events: 25,
        identified_customers: 1,
        enabled: true,
        environment_matches: true,
        events_matched: true,
        customers_matched: false,
        suppressed: false,
        cooldown_ready: true,
        allowed: false,
        reason: 'customer_threshold',
      };
    },
    ...extra,
  });
}

const panel = (title: string) =>
  screen.getByRole('heading', { name: title }).closest('section') as HTMLElement;

beforeEach(() => {
  puts = {};
});
afterEach(() => vi.restoreAllMocks());

describe('IssueAlertPolicies', () => {
  it('sets the impact threshold and shows what apid saved', async () => {
    api();
    renderWithProviders(<IssueAlertPolicies accountId="acct" slug="shop" />);
    const impact = panel('Customer impact');
    expect(await within(impact).findByText('On at 3')).toBeInTheDocument();
    const input = within(impact).getByRole('spinbutton', { name: 'Verified customers' });
    await userEvent.clear(input);
    await userEvent.type(input, '0');
    await userEvent.click(within(impact).getByRole('button', { name: 'Save' }));
    expect(await within(impact).findByText('Off')).toBeInTheDocument();
    expect(puts.impact).toEqual([{ minimum_customers: 0 }]);
  });

  it('replaces the frequency rules against the revision they were read at', async () => {
    api();
    renderWithProviders(<IssueAlertPolicies accountId="acct" slug="shop" />);
    const frequency = panel('Event frequency');
    expect(await within(frequency).findByDisplayValue('production-burst')).toBeInTheDocument();
    await userEvent.click(within(frequency).getByRole('button', { name: 'Add rule' }));
    await userEvent.click(within(frequency).getByRole('button', { name: 'Save rules' }));
    await waitFor(() => expect(puts.frequency).toHaveLength(1));
    expect(puts.frequency[0]).toEqual({
      expected_revision: 4,
      rules: [
        rule,
        {
          key: 'rule-2',
          enabled: true,
          environment: '',
          minimum_events: 50,
          window_seconds: 300,
          cooldown_seconds: 1800,
        },
      ],
    });
    expect(await within(frequency).findByText(/Revision 5\./)).toBeInTheDocument();
  });

  it('refuses out-of-bounds rules before sending', async () => {
    api();
    renderWithProviders(<IssueAlertPolicies accountId="acct" slug="shop" />);
    const frequency = panel('Event frequency');
    const events = await within(frequency).findByRole('spinbutton', { name: 'Events' });
    await userEvent.clear(events);
    await userEvent.type(events, '0');
    await userEvent.click(within(frequency).getByRole('button', { name: 'Save rules' }));
    expect(await within(frequency).findByText(/events from 1 to 100,000/)).toBeInTheDocument();
    expect(puts.frequency).toBeUndefined();
  });

  it('offers a reload instead of overwriting a newer revision', async () => {
    const spies = api({
      'PUT /v1/apps/{slug}/issue-frequency-alert-policy': () =>
        problem(409, 'issue_frequency_alert_revision_conflict', 'reload'),
    });
    renderWithProviders(<IssueAlertPolicies accountId="acct" slug="shop" />);
    const frequency = panel('Event frequency');
    await within(frequency).findByDisplayValue('production-burst');
    await userEvent.click(within(frequency).getByRole('button', { name: /Remove rule/ }));
    await userEvent.click(within(frequency).getByRole('button', { name: 'Save rules' }));
    expect(await within(frequency).findByText(/changed since you opened them/)).toBeInTheDocument();
    spies.GET.mockClear();
    await userEvent.click(within(frequency).getByRole('button', { name: 'Reload saved rules' }));
    await waitFor(() =>
      expect(spies.GET).toHaveBeenCalledWith(
        '/v1/apps/{slug}/issue-frequency-alert-policy',
        expect.anything()
      )
    );
  });

  it('previews a draft lifecycle filter against an issue, then saves it', async () => {
    api();
    renderWithProviders(<IssueAlertPolicies accountId="acct" slug="shop" />);
    const lifecycle = panel('New-issue and regression alerts');
    const envs = await within(lifecycle).findByRole('textbox', { name: 'Environments' });
    await userEvent.type(envs, 'production, staging');
    const cooldown = within(lifecycle).getByRole('spinbutton', { name: 'Cooldown (s)' });
    await userEvent.clear(cooldown);
    await userEvent.type(cooldown, '1800');
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Preview against issue' })).toHaveValue(ISSUE)
    );
    await userEvent.click(within(lifecycle).getByRole('button', { name: 'Preview' }));
    expect(await within(lifecycle).findByText('Cooling down')).toBeInTheDocument();
    expect(puts.lifecyclePreview[0]).toEqual({
      issue_id: ISSUE,
      event: 'regressed',
      environments: ['production', 'staging'],
      cooldown_seconds: 1800,
    });
    await userEvent.click(within(lifecycle).getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(puts.lifecycle).toHaveLength(1));
    expect(puts.lifecycle[0]).toEqual({
      expected_revision: 0,
      environments: ['production', 'staging'],
      cooldown_seconds: 1800,
    });
  });

  it('previews an unsaved compound rule and names the predicate that holds it back', async () => {
    api();
    renderWithProviders(<IssueAlertPolicies accountId="acct" slug="shop" />);
    const compound = panel('Compound: frequency and verified customers');
    await userEvent.click(await within(compound).findByRole('button', { name: 'Add rule' }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Preview against issue' })).toHaveValue(ISSUE)
    );
    await userEvent.click(within(compound).getByRole('button', { name: 'Preview' }));
    expect(await within(compound).findByText('Below the customer threshold')).toBeInTheDocument();
    expect(within(compound).getByText(/25 events and 1 verified customers/)).toBeInTheDocument();
    expect(puts.compoundPreview[0]).toMatchObject({
      issue_id: ISSUE,
      rule: { key: 'rule-1', minimum_customers: 3, minimum_events: 20 },
    });
    expect(puts.compound).toBeUndefined();
  });
});

describe('alert policy helpers', () => {
  it('checks rules as apid bounds them', () => {
    expect(ruleErrors([rule], false)).toEqual([]);
    expect(ruleErrors([{ ...rule, key: 'Bad Key' }], false)[0]).toMatch(/key/);
    expect(ruleErrors([rule, rule], false)[0]).toMatch(/used twice/);
    expect(ruleErrors([{ ...rule, window_seconds: 59 }], false)[0]).toMatch(/window/);
    expect(ruleErrors([rule], true)[0]).toMatch(/verified customers/);
    expect(ruleErrors([{ ...rule, minimum_customers: 3 }], true)).toEqual([]);
  });

  it('parses environment lists and words seconds', () => {
    expect(parseEnvironments('production, staging production')).toEqual(['production', 'staging']);
    expect(parseEnvironments('')).toEqual([]);
    expect(parseEnvironments('Prod')).toBeUndefined();
    expect(seconds(1800)).toBe('1800 s (30 min)');
    expect(seconds(7200)).toBe('7200 s (2 h)');
  });
});
