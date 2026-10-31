import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { problem, renderWithProviders, routeApi, type Answer } from '@/test/monetization';

const { RequestAuditPanel } = await import('./request-audit');

const PATH = '/v1/apps/{slug}/audit/requests';
const H = 3_600_000;

function record(n: number, extra: Record<string, unknown> = {}) {
  return {
    event_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    account_id: 'acct-1',
    app_id: 'app-1',
    route_template: '/orders/{id}',
    method: 'GET',
    http_status: 200,
    latency_ms: 41,
    occurred_at: new Date(Date.now() - n * 60_000).toISOString(),
    ...extra,
  };
}

let answer: (query: Record<string, unknown>) => Answer;
let spies: ReturnType<typeof routeApi>;

beforeEach(() => {
  answer = () => ({
    app_id: 'app-1',
    since: new Date(Date.now() - 24 * H).toISOString(),
    until: new Date().toISOString(),
    records: [
      record(1, {
        method: 'POST',
        route_template: '/orders',
        http_status: 500,
        latency_ms: 312,
        consumer_id: '3f6c2a1e-8b4d-4c7a-9e21-5d0f7b3a6c48',
        source_ip: '203.0.113.24',
        request_id: 'req_7f3a',
      }),
      record(2),
    ],
  });
  spies = routeApi({ [`GET ${PATH}`]: (init) => answer(init.params?.query ?? {}) });
});

afterEach(() => vi.restoreAllMocks());

const lastQuery = () =>
  (spies.GET.mock.calls.at(-1)![1] as { params: { query: Record<string, string | number> } }).params
    .query;

it('lists the exact records, newest first, with who called and from where', async () => {
  renderWithProviders(<RequestAuditPanel slug="api" />);
  expect(await screen.findByText('/orders')).toBeInTheDocument();
  expect(screen.getAllByText('/orders/{id}').length).toBeGreaterThan(0);
  expect(screen.getAllByText('203.0.113.24').length).toBeGreaterThan(0);
  expect(screen.getAllByText('req_7f3a').length).toBeGreaterThan(0);
  expect(screen.getByText('500')).toBeInTheDocument();
  expect(screen.getByText('312 ms')).toBeInTheDocument();
});

it('says what is collected, what is not, and how long it is kept', async () => {
  renderWithProviders(<RequestAuditPanel slug="api" />);
  await screen.findByText('/orders');
  expect(screen.getByText(/kept 30 days/)).toBeInTheDocument();
  expect(screen.getByText(/no query strings, headers or bodies/i)).toBeInTheDocument();
  expect(screen.getByText(/personal data/i)).toBeInTheDocument();
});

it('asks for the newest 100 of the last 24 hours, and a wider window on request', async () => {
  renderWithProviders(<RequestAuditPanel slug="api" />);
  await screen.findByText('/orders');
  let query = lastQuery();
  expect(query.limit).toBe(100);
  expect(Date.parse(String(query.until)) - Date.parse(String(query.since))).toBe(24 * H);

  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Window' }), '30d');
  await waitFor(() => {
    query = lastQuery();
    expect(Date.parse(String(query.until)) - Date.parse(String(query.since))).toBe(30 * 24 * H);
  });
});

it('offers up to 500 when the newest 100 fill the page, then says where the list stops', async () => {
  answer = (query) => ({
    app_id: 'app-1',
    since: '2026-10-30T00:00:00Z',
    until: '2026-10-31T00:00:00Z',
    records: Array.from({ length: Number(query.limit) }, (_, i) => record(i + 1)),
  });
  renderWithProviders(<RequestAuditPanel slug="api" />);
  await userEvent.click(await screen.findByRole('button', { name: /show up to 500/i }));
  await waitFor(() => expect(lastQuery().limit).toBe(500));
  expect(await screen.findByText(/at most 500 records/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /show up to 500/i })).not.toBeInTheDocument();
});

it('when nothing was recorded, says collection is off by default and is not a per-app switch', async () => {
  answer = () => ({
    app_id: 'app-1',
    since: '2026-10-30T00:00:00Z',
    until: '2026-10-31T00:00:00Z',
    records: [],
  });
  renderWithProviders(<RequestAuditPanel slug="api" />);
  expect(await screen.findByText(/no audit records in this window/i)).toBeInTheDocument();
  expect(screen.getByText(/off by default/i)).toBeInTheDocument();
  expect(screen.getByText(/not a per-app or gregale\.yaml setting/i)).toBeInTheDocument();
});

it('names the MFA requirement on mfa_required', async () => {
  answer = () => problem(403, 'mfa_required', 'complete /v1/account/mfa/verify');
  renderWithProviders(<RequestAuditPanel slug="api" />);
  expect(await screen.findByText(/verify with your second factor/i)).toBeInTheDocument();
});

// A 503 is retryable, so the hook's own retry policy runs twice first.
it('says the audit store is briefly unavailable on capacity_unavailable', async () => {
  answer = () => problem(503, 'capacity_unavailable', 'request audit');
  renderWithProviders(<RequestAuditPanel slug="api" />);
  expect(
    await screen.findByText(/request audit is briefly unavailable/i, {}, { timeout: 6000 })
  ).toBeInTheDocument();
}, 10_000);

it('keeps the API prose for any other failure', async () => {
  answer = () => problem(400, 'validation_failed', 'limit must be between 1 and 500');
  renderWithProviders(<RequestAuditPanel slug="api" />);
  expect(await screen.findByText(/limit must be between 1 and 500/i)).toBeInTheDocument();
});
