import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  drains: [] as unknown[],
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  kinds: ['http_json', 'otlp'] as string[],
  stage: 'Beta',
}));
vi.mock('@/lib/api/log-drain-capabilities', () => ({
  useLogDrainKinds: () => state.kinds,
  useLogDrainStage: () => state.stage,
}));
vi.mock('@/lib/api/log-drains', () => ({
  useLogDrains: () => ({ data: state.drains, isPending: false, error: null, refetch: vi.fn() }),
  useCreateLogDrain: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateLogDrain: () => ({ mutateAsync: state.update, isPending: false }),
  useDeleteLogDrain: () => ({ mutateAsync: state.remove, isPending: false }),
  useLogDrainHealth: () => ({
    data: {
      status: 'degraded',
      last_error: 'HTTP 503 from destination',
      delivered_total: 1200,
      failed_total: 4,
      dropped_total: 0,
      queue_depth: 7,
      queue_capacity: 10000,
      dead_letter_total: 0,
      gaps_total: 0,
      retries_total: 12,
      updated_at: '2026-10-01T00:00:00Z',
    },
    isPending: false,
    error: null,
  }),
  useLogDrainAnalytics: () => ({
    data: {
      buckets: [],
      summary: { success_rate: 0.997, average_latency_ms: 142, retries: 9 },
    },
    isPending: false,
    error: null,
  }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/dither-kit', () => ({
  Area: () => null,
  AreaChart: () => <div data-testid="chart" />,
  Grid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const { LogDrainsBody } = await import('./log-drains');

const drain = {
  id: 'ld-1',
  app_id: 'app-1',
  account_id: 'acct',
  kind: 'otlp',
  target_url: 'https://otel.example.com/v1/logs',
  auth_header_masked: '***',
  enabled: true,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  state.drains = [];
  state.create.mockReset().mockResolvedValue(drain);
  state.update.mockReset().mockResolvedValue(drain);
  state.remove.mockReset().mockResolvedValue(undefined);
  state.confirm.mockReset().mockResolvedValue(true);
  state.kinds = ['http_json', 'otlp'];
  state.stage = 'Beta';
});

describe('LogDrainsBody', () => {
  it('says logs stay in the console when there is no destination', () => {
    render(<LogDrainsBody slug="api" />);
    expect(screen.getByText(/Logs stay in the console until you add one/)).toBeInTheDocument();
  });

  it('adds a destination and never sends an empty auth header', async () => {
    render(<LogDrainsBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add destination' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a log destination' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add destination' }));
    expect(within(dialog).getByText('Enter an http(s) URL.')).toBeInTheDocument();
    expect(state.create).not.toHaveBeenCalled();
    await userEvent.type(
      within(dialog).getByLabelText('Endpoint URL'),
      'https://logs.example.com/ingest'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add destination' }));
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith({
        kind: 'http_json',
        target_url: 'https://logs.example.com/ingest',
        enabled: true,
      })
    );
  });

  it("shows a destination's health and deletes it only after confirming", async () => {
    state.drains = [drain];
    render(<LogDrainsBody slug="api" />);
    expect(screen.getByText(/auth header set/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('https://otel.example.com/v1/logs'));
    expect(screen.getByText('degraded')).toBeInTheDocument();
    expect(screen.getByText('HTTP 503 from destination')).toBeInTheDocument();
    expect(screen.getByText('7 / 10000')).toBeInTheDocument();
    expect(screen.getByText(/99.7% delivered/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true, confirmLabel: 'Delete destination' })
    );
    await waitFor(() => expect(state.remove).toHaveBeenCalledWith('ld-1'));
  });

  it("labels the surface with the log-drains capability's stage", () => {
    render(<LogDrainsBody slug="api" />);
    expect(screen.getByText(/^Beta · Send this app's runtime logs/)).toBeInTheDocument();
    state.stage = '';
    render(<LogDrainsBody slug="web" />);
    expect(screen.getByText(/^Send this app's runtime logs/)).toBeInTheDocument();
  });

  it('adds a Datadog destination from a site and an API key when Datadog is on', async () => {
    state.kinds = ['http_json', 'otlp', 'datadog'];
    render(<LogDrainsBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add destination' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a log destination' });
    await userEvent.selectOptions(within(dialog).getByLabelText('Format'), 'datadog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Datadog site'), 'eu1');
    await userEvent.type(within(dialog).getByLabelText('Datadog API key'), 'dd-key');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add destination' }));
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith({
        kind: 'datadog',
        target_url: 'https://http-intake.logs.datadoghq.eu/api/v2/logs',
        auth_header: 'DD-API-KEY: dd-key',
        enabled: true,
      })
    );
  });

  it('keeps the dialog open on the plan quota and links to plans', async () => {
    state.create.mockRejectedValue(
      new ApiError({
        status: 403,
        code: 'plan_log_drain_quota',
        title: 'Log drain limit reached',
        detail:
          'hobby plan caps log drains at 3 for this app; you have 3. Delete one to add another.',
      })
    );
    render(<LogDrainsBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add destination' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a log destination' });
    await userEvent.type(within(dialog).getByLabelText('Endpoint URL'), 'https://x.example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add destination' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/caps log drains at 3/);
    expect(within(alert).getByRole('link', { name: 'View plans' })).toHaveAttribute(
      'href',
      '/dashboard/plans'
    );
  });

  it('names Datadog destinations by their site in the list', () => {
    state.drains = [
      {
        ...drain,
        kind: 'datadog',
        target_url: 'https://http-intake.logs.datadoghq.com/api/v2/logs',
      },
    ];
    render(<LogDrainsBody slug="api" />);
    expect(screen.getByText(/Datadog · us1/)).toBeInTheDocument();
  });
});
