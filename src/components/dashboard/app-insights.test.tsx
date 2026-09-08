import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';

const useAppWakeTimeline = vi.fn();
const useAppUsage = vi.fn();
const useAppEnvDiff = vi.fn();
const useAppStaticEgressIP = vi.fn();
const useAppStreamingCap = vi.fn();
const setIp = vi.fn();
const clearIp = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useAppWakeTimeline: (slug: string) => useAppWakeTimeline(slug) as unknown,
  useAppUsage: (slug: string) => useAppUsage(slug) as unknown,
  useAppEnvDiff: (slug: string) => useAppEnvDiff(slug) as unknown,
  useAppStaticEgressIP: (slug: string) => useAppStaticEgressIP(slug) as unknown,
  useAppStreamingCap: (slug: string) => useAppStreamingCap(slug) as unknown,
  useSetAppStaticEgressIP: () => ({ mutateAsync: setIp, isPending: false }),
  useClearAppStaticEgressIP: () => ({ mutateAsync: clearIp, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const {
  AppUsagePanel,
  EnvDiffPanel,
  StaticEgressIP,
  StreamingCapNote,
  WakeTimelinePanel,
  streamingLine,
} = await import('./app-insights');

const ready = (data: unknown) => ({ data, isPending: false, error: null });
const gated = (code: string, detail: string) => ({
  data: undefined,
  isPending: false,
  error: new ApiError({ status: 402, code, title: 'Not on your plan', detail }),
});

beforeEach(() => {
  useAppWakeTimeline.mockReset().mockReturnValue(
    ready({
      app: { app_id: 'a', slug: 'api' },
      wake_count_24h: 3,
      wake_count_with_meta: 2,
      at_capacity_count: 1,
      at_capacity_pct: 33.3,
      trigger_histogram: { 'http.request': 2, 'cron.fired': 1 },
      trigger_class_histogram: { user: 2, monitor: 1 },
      rows: [
        {
          kind: 'wake.boot_started',
          state: 'RUNNING',
          at: '2026-09-08T09:00:00Z',
          tier: 'warm',
          trigger: 'http.request',
          ready_in_ms: 342,
          at_capacity: false,
          at_capacity_present: true,
        },
        {
          kind: 'wake.boot_started',
          state: 'RUNNING',
          at: '2026-09-08T08:00:00Z',
          tier: 'init',
          trigger: 'cron.fired',
          ready_in_ms: -1,
          at_capacity: true,
          queued_count: 2,
          at_capacity_present: true,
        },
      ],
      as_of: '2026-09-08T09:30:00Z',
    })
  );
  useAppUsage.mockReset().mockReturnValue(
    ready({
      slug: 'api',
      period_start: '2026-08-09T00:00:00Z',
      period_end: '2026-09-08T00:00:00Z',
      mb_seconds: 1,
      gb_hours: 1.135417,
      requests: 8421,
      tx_bytes: 94371840,
      builder_seconds: 192.5,
      cold_boot_count: 14,
      plan_included_gb_hours: 50,
      overage_gb_hours: 0,
      source: 'usage_minutes',
      as_of: '2026-09-08T09:30:00Z',
    })
  );
  useAppEnvDiff.mockReset().mockReturnValue(
    ready({
      app_slug: 'api',
      scopes: ['production', 'preview'],
      generated_at: '2026-09-08T09:30:00Z',
      rows: [
        {
          key: 'LOG_LEVEL',
          kind: 'env',
          cells: {
            production: { present: true, value: 'info' },
            preview: { present: true, value: 'debug' },
          },
        },
        {
          key: 'DB_URL',
          kind: 'secret',
          cells: {
            production: { present: true, value_hash: 'abcdef1234' },
            preview: { present: false },
          },
        },
        {
          key: 'REGION',
          kind: 'env',
          cells: {
            production: { present: true, value: 'fra' },
            preview: { present: true, value: 'fra' },
          },
        },
      ],
    })
  );
  useAppStaticEgressIP
    .mockReset()
    .mockReturnValue(ready({ ip: null, set_at: null, plan_cap: 1, plan_allowed: true }));
  useAppStreamingCap.mockReset().mockReturnValue(
    ready({
      app_id: 'a',
      status: 'streaming',
      effective_cap_bytes: 104857600,
      plan_cap_bytes: 104857600,
      flag_enabled: true,
      plan_allowed: true,
      cap_kind: 'plan',
    })
  );
  setIp.mockReset().mockResolvedValue({
    ip: '203.0.113.42',
    set_at: '2026-09-08T09:30:00Z',
    plan_cap: 1,
    plan_allowed: true,
  });
  clearIp.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('WakeTimelinePanel', () => {
  it('shows each wake with its tier and measured ready time, and — when unmeasured', () => {
    render(<WakeTimelinePanel slug="api" />);
    expect(screen.getByText('342 ms')).toBeInTheDocument();
    expect(screen.getByText('warm')).toBeInTheDocument();
    expect(screen.getByText('init')).toBeInTheDocument();
    expect(screen.getByText('queued 2')).toBeInTheDocument();
    expect(screen.getByText(/33\.3% of wakes queued/)).toBeInTheDocument();
  });

  it('renders the Free-plan 402 as the plan panel, by code', async () => {
    useAppWakeTimeline.mockReturnValue(
      gated('plan_per_app_metrics_not_allowed', 'the free plan does not include per-app metrics.')
    );
    render(withRouter(<WakeTimelinePanel slug="api" />));
    expect(await screen.findByText(/does not include per-app metrics/i)).toBeInTheDocument();
  });
});

describe('AppUsagePanel', () => {
  it('shows GB-hours against the plan allowance and formats egress bytes', () => {
    render(<AppUsagePanel slug="api" />);
    expect(screen.getByText('1.14')).toBeInTheDocument();
    expect(screen.getByText('of 50 included')).toBeInTheDocument();
    expect(screen.getByText('90 MB')).toBeInTheDocument();
  });
});

describe('EnvDiffPanel', () => {
  it('marks rows as same, differs, or partial from the cells the API returned', () => {
    render(<EnvDiffPanel slug="api" />);
    expect(screen.getByText('differs')).toBeInTheDocument();
    expect(screen.getByText('partial')).toBeInTheDocument();
    expect(screen.getByText('same')).toBeInTheDocument();
    expect(screen.getByText('missing')).toBeInTheDocument();
    expect(screen.getByText('abcdef12')).toBeInTheDocument();
  });
});

describe('StaticEgressIP', () => {
  it('pins a valid IPv4 and refuses to submit an invalid one', async () => {
    render(<StaticEgressIP slug="api" />);
    const input = screen.getByLabelText('IPv4 address to pin');
    await userEvent.type(input, '10.0.0');
    expect(screen.getByRole('button', { name: /pin/i })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, '203.0.113.42');
    await userEvent.click(screen.getByRole('button', { name: /pin/i }));
    await waitFor(() => expect(setIp).toHaveBeenCalledWith('203.0.113.42'));
  });

  it('says the plan does not allow a pin instead of offering the form', () => {
    useAppStaticEgressIP.mockReturnValue(
      ready({ ip: null, set_at: null, plan_cap: 0, plan_allowed: false })
    );
    render(<StaticEgressIP slug="api" />);
    expect(screen.getByText(/needs the scale plan/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /pin/i })).not.toBeInTheDocument();
  });

  it('confirms before clearing an existing pin', async () => {
    useAppStaticEgressIP.mockReturnValue(
      ready({ ip: '203.0.113.42', set_at: '2026-09-08T09:00:00Z', plan_cap: 1, plan_allowed: true })
    );
    render(<StaticEgressIP slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /clear/i }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(clearIp).toHaveBeenCalled();
  });
});

describe('streaming classification', () => {
  it('puts the probe verdict into one sentence per status', () => {
    expect(
      streamingLine({
        app_id: 'a',
        status: 'streaming',
        effective_cap_bytes: 104857600,
        plan_cap_bytes: 104857600,
        flag_enabled: true,
        plan_allowed: true,
        cap_kind: 'plan',
      })
    ).toMatch(/stream up to 100 MB/);
    expect(
      streamingLine({
        app_id: 'a',
        status: 'plan-disallows',
        effective_cap_bytes: 0,
        plan_cap_bytes: 0,
        flag_enabled: true,
        plan_allowed: false,
      })
    ).toMatch(/plan does not include/);
    expect(
      streamingLine({
        app_id: 'a',
        status: 'flag-disabled',
        effective_cap_bytes: 0,
        plan_cap_bytes: 1,
        flag_enabled: false,
        plan_allowed: true,
      })
    ).toMatch(/flag above is off/);
  });

  it('renders the note for the app', () => {
    render(
      <ul>
        <StreamingCapNote slug="api" />
      </ul>
    );
    expect(screen.getByText(/responses stream up to 100 MB/)).toBeInTheDocument();
  });
});
