import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Handlers } from '@/test/monetization';
import { IssueTrackerLinks, LinearConnectionPanel, explainTrackerError } from './issue-trackers';
import { ApiError } from '@/lib/api/errors';

const ISSUE = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TEAM = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const KEY = 'lin_api_fake_key_for_tests';
const connected = {
  connected: true,
  revision: 2,
  auth_method: 'api_key',
  team_id: TEAM,
  workspace_id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  viewer_id: '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
  webhook_enabled: false,
};
const link = {
  id: 'l-1',
  original_issue_id: ISSUE,
  provider: 'github',
  external_key: 'acme/shop#42',
  url: 'https://github.com/acme/shop/issues/42',
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  title: 'Fix checkout',
};

let calls: { method: string; body: unknown }[];
function api(extra: Handlers = {}) {
  const log = (method: string) => (init: { body?: unknown }) => {
    calls.push({ method, body: init.body });
  };
  return routeApi({
    'GET /v1/apps/{slug}/issue-tracker-linear-connection': () => ({
      connected: false,
      revision: 0,
    }),
    'PUT /v1/apps/{slug}/issue-tracker-linear-connection': (init) => {
      log('PUT connection')(init);
      return (init.body as { connected: boolean }).connected
        ? { ...connected, revision: 1 }
        : { connected: false, revision: 3 };
    },
    'GET /v1/apps/{slug}/issues/{issue_id}': () => ({
      issue: { id: ISSUE, title: 'PaymentError' },
    }),
    'GET /v1/apps/{slug}/issues/{issue_id}/tracker-links': () => ({ items: [link] }),
    'POST /v1/apps/{slug}/issues/{issue_id}/tracker-links': (init) => {
      log('POST link')(init);
      return link;
    },
    'DELETE /v1/apps/{slug}/issues/{issue_id}/tracker-links/{link_id}': (init) => {
      log('DELETE link')(init);
      return undefined;
    },
    'POST /v1/apps/{slug}/issues/{issue_id}/native-linear-tickets': (init) => {
      log('POST ticket')(init);
      return {
        request_id: (init.body as { request_id: string }).request_id,
        state: 'linked',
        ticket_url: 'https://linear.app/acme/issue/ENG-7',
        link_id: 'l-2',
      };
    },
    ...extra,
  });
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('LinearConnectionPanel', () => {
  it('connects with a key sent once, cleared after, and keeps only metadata', async () => {
    api();
    const { client } = renderWithProviders(<LinearConnectionPanel accountId="acct" slug="shop" />);
    expect(await screen.findByText('Not connected.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Team UUID' }), TEAM);
    const key = screen.getByLabelText('Personal API key');
    await userEvent.type(key, KEY);
    await userEvent.click(screen.getByRole('button', { name: 'Connect Linear' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({
      connected: true,
      expected_revision: 0,
      team_id: TEAM,
      api_key: KEY,
    });
    expect(await screen.findByText(/Connected \(API key\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Personal API key')).toHaveValue('');
    // The key reaches no cache: not the query, not a mutation.
    const cached = JSON.stringify([
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.variables),
    ]);
    expect(cached).not.toContain(KEY);
  });

  it('refuses a short webhook secret and a team that is not a UUID', async () => {
    api();
    renderWithProviders(<LinearConnectionPanel accountId="acct" slug="shop" />);
    await screen.findByText('Not connected.');
    await userEvent.type(screen.getByRole('textbox', { name: 'Team UUID' }), 'ENG');
    await userEvent.type(screen.getByLabelText('Personal API key'), KEY);
    expect(screen.getByRole('button', { name: 'Connect Linear' })).toBeDisabled();
    await userEvent.clear(screen.getByRole('textbox', { name: 'Team UUID' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Team UUID' }), TEAM);
    await userEvent.type(screen.getByLabelText('Webhook secret (optional)'), 'short');
    expect(screen.getByRole('button', { name: 'Connect Linear' })).toBeDisabled();
  });

  it('disconnects after confirming, sending no credential', async () => {
    api({ 'GET /v1/apps/{slug}/issue-tracker-linear-connection': () => connected });
    renderWithProviders(<LinearConnectionPanel accountId="acct" slug="shop" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ connected: false, expected_revision: 2 });
    expect(await screen.findByText('Not connected.')).toBeInTheDocument();
  });

  it('tells a member that only the owner manages the connection', async () => {
    api({
      'GET /v1/apps/{slug}/issue-tracker-linear-connection': () =>
        problem(403, 'forbidden', 'only the app owner may manage the Linear connection'),
    });
    renderWithProviders(<LinearConnectionPanel accountId="acct" slug="shop" />);
    expect(
      await screen.findByText('only the app owner may manage the Linear connection')
    ).toBeInTheDocument();
  });
});

describe('IssueTrackerLinks', () => {
  it('lists, links and removes references without contacting the provider', async () => {
    api();
    renderWithProviders(<IssueTrackerLinks accountId="acct" slug="shop" issueId={ISSUE} />);
    expect(await screen.findByText(/GitHub acme\/shop#42 · Fix checkout/)).toBeInTheDocument();
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Ticket URL' }),
      'https://linear.app/acme/issue/ENG-42'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Link ticket' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST link',
        body: { url: 'https://linear.app/acme/issue/ENG-42' },
      })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove acme/shop#42' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove reference' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE link')).toBe(true));
    expect(screen.queryByRole('heading', { name: 'Create a Linear ticket' })).toBeNull();
  });

  it('creates a Linear ticket with one request ID kept for a retry', async () => {
    let first = true;
    api({
      'GET /v1/apps/{slug}/issue-tracker-linear-connection': () => connected,
      'POST /v1/apps/{slug}/issues/{issue_id}/native-linear-tickets': ({ body }) => {
        calls.push({ method: 'POST ticket', body });
        if (first) {
          first = false;
          return {
            request_id: (body as { request_id: string }).request_id,
            state: 'created',
            ticket_url: 'https://linear.app/acme/issue/ENG-7',
          };
        }
        return {
          request_id: (body as { request_id: string }).request_id,
          state: 'linked',
          ticket_url: 'https://linear.app/acme/issue/ENG-7',
          link_id: 'l-2',
        };
      },
    });
    renderWithProviders(<IssueTrackerLinks accountId="acct" slug="shop" issueId={ISSUE} />);
    const title = await screen.findByRole('textbox', { name: 'Ticket title' });
    expect(title).toHaveValue('PaymentError');
    await userEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
    expect(await screen.findByText(/exists in Linear but is not attached yet/)).toBeInTheDocument();
    expect(title).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }));
    expect(await screen.findByText('Linked')).toBeInTheDocument();
    const tickets = calls
      .filter((c) => c.method === 'POST ticket')
      .map((c) => c.body as Record<string, unknown>);
    expect(tickets).toHaveLength(2);
    expect(tickets[0]).toEqual({
      request_id: tickets[1].request_id,
      team_id: TEAM,
      title: 'PaymentError',
    });
    expect(String(tickets[0].request_id)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('after an unconfirmed create, offers recovery by the same request once the lease passes', async () => {
    const bodies: Record<string, unknown>[] = [];
    api({
      'GET /v1/apps/{slug}/issue-tracker-linear-connection': () => connected,
      'POST /v1/apps/{slug}/issues/{issue_id}/native-linear-tickets': ({ body }) => {
        bodies.push(body as Record<string, unknown>);
        return bodies.length === 1
          ? problem(409, 'issue_tracker_creation_unconfirmed', 'unconfirmed')
          : {
              request_id: (body as { request_id: string }).request_id,
              state: 'linked',
              ticket_url: 'https://linear.app/acme/issue/ENG-8',
            };
      },
    });
    renderWithProviders(<IssueTrackerLinks accountId="acct" slug="shop" issueId={ISSUE} />);
    await screen.findByRole('textbox', { name: 'Ticket title' });
    await userEvent.click(screen.getByRole('button', { name: 'Create ticket' }));
    expect(
      await screen.findByText(/did not confirm whether the ticket was created/)
    ).toBeInTheDocument();
    const recover = screen.getByRole('button', { name: /Recover in \d+ s/ });
    expect(recover).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send again' })).toBeNull();
    expect(screen.getByText(/--native --recover/)).toBeInTheDocument();
  });
});

describe('tracker errors', () => {
  it('words apid’s codes', () => {
    const e = (code: string) => new ApiError({ status: 409, code, title: code });
    expect(explainTrackerError(e('issue_tracker_linear_verification_failed'))).toMatch(
      /did not verify/
    );
    expect(explainTrackerError(e('issue_tracker_request_conflict'))).toMatch(/original inputs/);
  });
});
