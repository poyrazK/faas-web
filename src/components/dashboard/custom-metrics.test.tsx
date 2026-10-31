import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';

const state = vi.hoisted(() => ({
  access: {} as Record<string, string>,
  maturity: 'beta' as string | undefined,
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: (id: string) => ({
    access: state.access[id] ?? 'on',
    capability: undefined,
    refresh: vi.fn(),
  }),
  useCapability: (key: string) => ({
    accountId: 'acct',
    capability:
      key === 'custom-metrics' && state.maturity ? { maturity: state.maturity } : undefined,
    state: 'available',
    refresh: vi.fn(),
  }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));
vi.mock('@/components/dither-kit', () => ({
  Area: () => null,
  AreaChart: ({ data }: { data: unknown[] }) => (
    <div data-testid="chart" data-points={data.length} />
  ),
  Grid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const { CustomMetricsPanel } = await import('./custom-metrics');

const metrics = [
  {
    name: 'orders_pending',
    value: 1284,
    observed_at: new Date(Date.now() - 60_000).toISOString(),
    stale: false,
    kind: 'gauge',
  },
  {
    name: 'ocr_backlog',
    value: 7,
    observed_at: new Date(Date.now() - 3_600_000).toISOString(),
    stale: true,
    kind: 'gauge',
  },
  {
    name: 'payments_failed',
    value: 31,
    observed_at: new Date(Date.now() - 30_000).toISOString(),
    stale: false,
    kind: 'counter',
  },
];
const listBody = (rows = metrics, max = 5) => ({
  metrics: rows,
  freshness_seconds: 300,
  max_metrics: max,
});
const series = (overrides: Record<string, unknown> = {}) => ({
  app_id: 'app-1',
  name: 'orders_pending',
  kind: 'gauge',
  range: '24h',
  step: '15m',
  source: 'prometheus',
  points: [
    { at: '2026-10-31T10:00:00Z', value: 900 },
    { at: '2026-10-31T10:15:00Z', value: 1100 },
    { at: '2026-10-31T10:30:00Z', value: 1284 },
  ],
  ...overrides,
});
const ok = (data: unknown, status = 200) => ({ data, response: new Response(null, { status }) });
const problem = (status: number, code: string, detail: string) => ({
  error: { type: 'about:blank', title: code, status, code, detail },
  response: new Response(null, { status }),
});

let list: ReturnType<typeof listBody>;
let seriesReply: unknown;
let get: ReturnType<typeof spyApi>;

beforeEach(() => {
  state.access = {};
  state.maturity = 'beta';
  state.confirm.mockReset().mockResolvedValue(true);
  state.toast.mockReset();
  list = listBody();
  seriesReply = ok(series());
  get = spyApi('GET').mockImplementation((path: string) =>
    Promise.resolve(path.endsWith('/series') ? seriesReply : ok(list))
  );
});
afterEach(() => vi.restoreAllMocks());

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomMetricsPanel slug="api" />
    </QueryClientProvider>
  );
}

/** The table past its loading skeleton. */
async function loaded() {
  await screen.findByText('ocr_backlog');
  return screen.getByRole('table');
}

const seriesCalls = () => get.mock.calls.filter(([path]) => String(path).endsWith('/series'));

it('lists every pushed metric with its value, kind, freshness and the per-app cap', async () => {
  show();
  const table = await loaded();
  expect(within(table).getByText('orders_pending')).toBeInTheDocument();
  expect(within(table).getByText('1,284')).toBeInTheDocument();
  expect(within(table).getByText('payments_failed')).toBeInTheDocument();
  expect(within(table).getAllByText('gauge')).toHaveLength(2);
  expect(within(table).getByText('counter')).toBeInTheDocument();
  expect(screen.getByText(/3 of 5 metrics/)).toBeInTheDocument();
  expect(screen.getByText(/older than 5 minutes stop driving scaling/)).toBeInTheDocument();
});

it('says a stale row is not driving scaling and a counter never does', async () => {
  show();
  const table = await loaded();
  expect(within(table).getByText('stale')).toBeInTheDocument();
  expect(within(table).getByText(/not scaling/)).toBeInTheDocument();
  expect(within(table).getByText(/never scales/)).toBeInTheDocument();
});

it('reads its maturity from the capability, not a hardcoded label', async () => {
  state.maturity = 'beta';
  const first = show();
  expect(await screen.findByText('Beta')).toBeInTheDocument();
  first.unmount();
  state.maturity = 'preview';
  const second = show();
  expect(await screen.findByText('Preview')).toBeInTheDocument();
  second.unmount();
  state.maturity = undefined;
  show();
  await loaded();
  expect(screen.queryByText('Beta')).not.toBeInTheDocument();
  expect(screen.queryByText('Preview')).not.toBeInTheDocument();
});

it('calls nothing and explains itself while the capability is off', () => {
  state.access = { 'custom-metrics': 'off' };
  show();
  expect(screen.getByText('Not enabled for this account')).toBeInTheDocument();
  expect(get).not.toHaveBeenCalled();
});

it('says what to do when no metric has been pushed yet', async () => {
  list = listBody([]);
  show();
  expect(await screen.findByText(/No custom metrics yet/)).toBeInTheDocument();
  expect(seriesCalls()).toHaveLength(0);
});

it('shows the exact push request for this app, with the scope it needs', async () => {
  show();
  await loaded();
  const snippet = screen.getByText(/curl -X PUT/);
  expect(snippet.textContent).toContain(
    `${window.location.origin}/v1/apps/api/custom-metrics/orders_pending`
  );
  expect(snippet.textContent).toContain('-d \'{"value": 1284}\'');
  expect(snippet.textContent).toContain('Authorization: Bearer <METRICS_KEY>');
  expect(screen.getByText('metrics:write')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Scaling on custom metrics/ })).toHaveAttribute(
    'href',
    '/docs/scaling-policy#custom-metrics'
  );
});

it('checks name and value before pushing, the way apid does', async () => {
  const put = spyApi('PUT');
  show();
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Push a value' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Name'), 'Orders-Pending');
  await userEvent.type(within(dialog).getByLabelText('Value'), '-3');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Push value' }));
  expect(within(dialog).getByText('Start with a lowercase letter.')).toBeInTheDocument();
  expect(within(dialog).getByText(/Use 0 or more/)).toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
});

it('pushes a valid value as a number and closes', async () => {
  const put = spyApi('PUT').mockResolvedValue(ok(undefined, 204) as never);
  show();
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Push a value' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Name'), 'queue_depth');
  await userEvent.type(within(dialog).getByLabelText('Value'), '42.5');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Push value' }));
  await waitFor(() =>
    expect(put).toHaveBeenCalledWith('/v1/apps/{slug}/custom-metrics/{name}', {
      params: { path: { slug: 'api', name: 'queue_depth' } },
      body: { value: 42.5 },
    })
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
});

it('refuses a new name at the cap but still lets an existing one update', async () => {
  const put = spyApi('PUT').mockResolvedValue(ok(undefined, 204) as never);
  list = listBody(metrics, 3);
  show();
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Push a value' }));
  const dialog = await screen.findByRole('dialog');
  const name = within(dialog).getByLabelText('Name');
  await userEvent.type(name, 'brand_new');
  await userEvent.type(within(dialog).getByLabelText('Value'), '1');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Push value' }));
  expect(within(dialog).getByText(/already holds 3 metrics/)).toBeInTheDocument();
  expect(put).not.toHaveBeenCalled();
  await userEvent.clear(name);
  await userEvent.type(name, 'orders_pending');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Push value' }));
  await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
});

it('explains the cap when apid refuses with custom_metric_limit', async () => {
  spyApi('PUT').mockResolvedValue(
    problem(422, 'custom_metric_limit', 'this app already holds 5 custom metrics') as never
  );
  show();
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Push a value' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Name'), 'raced_in');
  await userEvent.type(within(dialog).getByLabelText('Value'), '1');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Push value' }));
  expect(await within(dialog).findByText(/already holds 5 metrics/)).toBeInTheDocument();
});

it('names the plan when apid refuses with plan_custom_metrics_not_allowed', async () => {
  spyApi('PUT').mockResolvedValue(
    problem(
      402,
      'plan_custom_metrics_not_allowed',
      'custom application metrics are not included in the free plan.'
    ) as never
  );
  show();
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Push a value' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Name'), 'orders_pending');
  await userEvent.type(within(dialog).getByLabelText('Value'), '1');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Push value' }));
  expect(await within(dialog).findByText(/not included in the free plan/)).toBeInTheDocument();
  expect(within(dialog).getByRole('link', { name: 'Compare plans' })).toBeInTheDocument();
});

it('deletes a metric only after a destructive confirmation', async () => {
  const del = spyApi('DELETE').mockResolvedValue(ok(undefined, 204) as never);
  state.confirm.mockResolvedValueOnce(false);
  show();
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Delete ocr_backlog' }));
  expect(state.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
  expect(del).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Delete ocr_backlog' }));
  await waitFor(() =>
    expect(del).toHaveBeenCalledWith('/v1/apps/{slug}/custom-metrics/{name}', {
      params: { path: { slug: 'api', name: 'ocr_backlog' } },
    })
  );
});

it('charts the selected metric’s recorded history and changes range', async () => {
  show();
  const chart = await screen.findByTestId('chart');
  expect(chart).toHaveAttribute('data-points', '3');
  expect(seriesCalls()[0][1]).toMatchObject({
    params: { path: { slug: 'api', name: 'orders_pending' }, query: { range: '24h' } },
  });
  await userEvent.click(screen.getByRole('button', { name: '7d' }));
  await waitFor(() =>
    expect(seriesCalls().at(-1)?.[1]).toMatchObject({ params: { query: { range: '7d' } } })
  );
  await userEvent.click(screen.getByText('payments_failed'));
  await waitFor(() =>
    expect(seriesCalls().at(-1)?.[1]).toMatchObject({
      params: { path: { name: 'payments_failed' } },
    })
  );
});

it('says a counter’s history is a per-second rate', async () => {
  seriesReply = ok(series({ name: 'payments_failed', kind: 'counter' }));
  show();
  await screen.findByTestId('chart');
  expect(screen.getByText(/per-second rate/)).toBeInTheDocument();
});

it('does not draw a degraded history', async () => {
  seriesReply = ok(series({ source: 'degraded: prometheus not configured', points: null }));
  show();
  expect(await screen.findByText(/History could not be read/)).toBeInTheDocument();
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
});

it('explains an installation without metric history', async () => {
  seriesReply = problem(
    503,
    'custom_metric_history_unavailable',
    'custom metric history is not enabled for this deployment'
  );
  show();
  expect(await screen.findByText(/not recorded on this installation/)).toBeInTheDocument();
  expect(screen.queryByTestId('chart')).not.toBeInTheDocument();
});

it('never asks for history while the history capability is off', async () => {
  state.access = { 'custom-metric-history': 'off' };
  show();
  await loaded();
  expect(screen.getByText(/History is not enabled for this account/)).toBeInTheDocument();
  expect(seriesCalls()).toHaveLength(0);
});

it('explains a 404 as the creator-only route it is', async () => {
  get.mockImplementation(() => Promise.resolve(problem(404, 'not_found', 'no such app') as never));
  show();
  expect(await screen.findByText(/only by the account that created this app/)).toBeInTheDocument();
});
