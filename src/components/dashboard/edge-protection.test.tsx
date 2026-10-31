import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useEdgeProtection = vi.fn();
const usePreAuthObservations = vi.fn();
const useAttackMode = vi.fn();
const switchOn = vi.fn();
const switchOff = vi.fn();
const useCapability = vi.fn();
const useCapabilityAccess = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/edge-protection', async (original) => ({
  ...(await original<typeof import('@/lib/api/edge-protection')>()),
  useEdgeProtection: (slug: string, range: string) => useEdgeProtection(slug, range) as unknown,
  usePreAuthObservations: (slug: string, range: string) =>
    usePreAuthObservations(slug, range) as unknown,
  useAttackMode: (slug: string) => useAttackMode(slug) as unknown,
  useSwitchAttackModeOn: () => ({ mutateAsync: switchOn, isPending: false }),
  useSwitchAttackModeOff: () => ({ mutateAsync: switchOff, isPending: false }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => useCapability(key) as unknown,
  useCapabilityAccess: (key: string) => useCapabilityAccess(key) as unknown,
}));
vi.mock('@/lib/api/workspace-apps', () => ({
  useWorkspaceTarget: () => ({ org: 'acme', label: 'Acme Inc', ready: true }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { EdgeProtectionBody } = await import('./edge-protection');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const failed = (error: unknown) => ({ data: undefined, isPending: false, error, refetch: vi.fn() });

const summary = (over: Record<string, unknown> = {}) => ({
  app_id: 'a1',
  range: '1h',
  source: 'prometheus',
  as_of: '2026-10-31T12:00:00Z',
  pre_auth: { blocked: 4, would_block: 37 },
  validation_failures: [],
  rejections: [{ gate: 'throttle', status: '429', count: 120 }],
  waf: {
    inspected: 900,
    detected: 3,
    not_inspected: 0,
    warned: 0,
    blocked: 2,
    inline_skipped: 0,
    categories: [],
    top_rules: [],
  },
  challenge: { issued: 10, solved: 8, rejected: 5, passed: 40, bypassed: 2, invalid: 0 },
  penalty: { boxed: 0, rejected: 0 },
  attack_mode: { active: false },
  ai_crawlers: [],
  ...over,
});

const observations = (over: Record<string, unknown> = {}) => ({
  app_id: 'a1',
  range: '1h',
  source: 'prometheus',
  as_of: '2026-10-31T12:00:00Z',
  policies: [
    {
      policy_id: 'app',
      kind: 'app',
      would_block: 37,
      result_2xx: 3,
      result_3xx: 0,
      result_4xx: 30,
      result_5xx: 4,
    },
    {
      policy_id: 'route_0',
      kind: 'route',
      method: 'POST',
      path: '/login',
      would_block: 12,
      result_2xx: 0,
      result_3xx: 0,
      result_4xx: 12,
      result_5xx: 0,
    },
  ],
  ...over,
});

const inOneHour = () => new Date(Date.now() + 60 * 60_000).toISOString();

beforeEach(() => {
  useEdgeProtection.mockReset().mockReturnValue(ready(summary()));
  usePreAuthObservations.mockReset().mockReturnValue(ready(observations()));
  useAttackMode.mockReset().mockReturnValue(ready({ active: false }));
  switchOn.mockReset().mockResolvedValue({ active: true, expires_at: inOneHour() });
  switchOff.mockReset().mockResolvedValue({ active: false });
  useCapability.mockReset().mockImplementation((key: string) => ({
    capability: { key, maturity: key === 'edge-attack-mode' ? 'preview' : 'beta' },
  }));
  useCapabilityAccess.mockReset().mockReturnValue({ access: 'on', refresh: vi.fn() });
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('EdgeProtectionBody', () => {
  it('labels the surface with the maturity the registry gives it', () => {
    render(<EdgeProtectionBody slug="api" />);
    expect(screen.getByText('Edge protection beta')).toBeInTheDocument();
    expect(screen.getByText('Attack mode preview')).toBeInTheDocument();
  });

  it('claims no stage when the registry does not describe the capability', () => {
    useCapability.mockReturnValue({ capability: undefined });
    render(<EdgeProtectionBody slug="api" />);
    expect(screen.queryByText(/beta|preview/i)).not.toBeInTheDocument();
  });

  it('summarises what the edge refused over the range', () => {
    render(<EdgeProtectionBody slug="api" />);
    const summaryPanel = screen.getByRole('region', { name: 'What the edge refused' });
    expect(within(summaryPanel).getByText('throttle')).toBeInTheDocument();
    expect(within(summaryPanel).getByText('120')).toBeInTheDocument();
  });

  it('says counts are unavailable rather than showing zeros when metrics are degraded', () => {
    useEdgeProtection.mockReturnValue(
      ready(summary({ source: 'degraded: prometheus unavailable', rejections: [] }))
    );
    render(<EdgeProtectionBody slug="api" />);
    expect(screen.getByText(/counts are unavailable: prometheus unavailable/i)).toBeInTheDocument();
  });

  it('reads the range from the picker', async () => {
    render(<EdgeProtectionBody slug="api" />);
    await userEvent.selectOptions(screen.getByLabelText('Range'), '24h');
    expect(useEdgeProtection).toHaveBeenLastCalledWith('api', '24h');
    expect(usePreAuthObservations).toHaveBeenLastCalledWith('api', '24h');
  });

  it('explains a company role refusal by naming the organization', () => {
    useEdgeProtection.mockReturnValue(
      failed(new ApiError({ status: 403, code: 'org_role_forbidden', title: 'Forbidden' }))
    );
    render(<EdgeProtectionBody slug="api" />);
    expect(screen.getAllByText(/Acme Inc/).length).toBeGreaterThan(0);
  });
});

describe('attack mode', () => {
  it('names the effect and the duration before switching on', async () => {
    render(<EdgeProtectionBody slug="api" />);
    await userEvent.selectOptions(screen.getByLabelText('Attack mode duration'), '10800');
    await userEvent.click(screen.getByRole('button', { name: 'Switch attack mode on' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    const asked = confirm.mock.calls[0][0] as { title: string; description: string };
    expect(asked.title).toMatch(/api/);
    expect(asked.title).toMatch(/3 hours/);
    expect(asked.description).toMatch(/every visitor/i);
    expect(asked.description).toMatch(/403/);
    expect(asked.description).toMatch(/ends on its own/i);
    expect(switchOn).toHaveBeenCalledWith(10800);
  });

  it('does nothing when the confirm is declined', async () => {
    confirm.mockResolvedValue(false);
    render(<EdgeProtectionBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch attack mode on' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(switchOn).not.toHaveBeenCalled();
  });

  it('shows when an active attack mode ends, and confirms switching it off', async () => {
    useAttackMode.mockReturnValue(
      ready({ active: true, started_at: '2026-10-31T11:00:00Z', expires_at: inOneHour() })
    );
    render(<EdgeProtectionBody slug="api" />);
    expect(screen.getByText(/^On · ends/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch attack mode off' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect((confirm.mock.calls[0][0] as { description: string }).description).toMatch(
      /no longer challenged/i
    );
    expect(switchOff).toHaveBeenCalled();
  });

  it('moves the end of an active attack mode with the same confirm', async () => {
    useAttackMode.mockReturnValue(ready({ active: true, expires_at: inOneHour() }));
    render(<EdgeProtectionBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Extend attack mode' }));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect((confirm.mock.calls[0][0] as { title: string }).title).toMatch(/extend/i);
    expect(switchOn).toHaveBeenCalledWith(3600);
  });

  it('reads edge_feature_unavailable as not yet released', async () => {
    switchOn.mockRejectedValue(
      new ApiError({ status: 422, code: 'edge_feature_unavailable', title: 'Not released' })
    );
    render(<EdgeProtectionBody slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch attack mode on' }));
    await waitFor(() =>
      expect(screen.getByText(/not yet available to this account/i)).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: 'Switch attack mode on' })).not.toBeInTheDocument();
  });

  it('offers no switch when the capability is off, but still lets an active one be switched off', () => {
    useCapabilityAccess.mockImplementation((key: string) => ({
      access: key === 'edge-attack-mode' ? 'off' : 'on',
      refresh: vi.fn(),
    }));
    useAttackMode.mockReturnValue(ready({ active: true, expires_at: inOneHour() }));
    render(<EdgeProtectionBody slug="api" />);
    expect(screen.getByText(/not yet available to this account/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Extend attack mode' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch attack mode off' })).toBeInTheDocument();
  });

  it('says when an attack mode that ran out ended', () => {
    useAttackMode.mockReturnValue(
      ready({ active: false, rule_id: 'r1', expires_at: '2026-10-30T09:00:00Z' })
    );
    render(<EdgeProtectionBody slug="api" />);
    expect(screen.getByText(/^Off · last ended/)).toBeInTheDocument();
  });
});

describe('pre-auth observations', () => {
  it('lists each configured policy with what observe mode would have blocked', () => {
    render(<EdgeProtectionBody slug="api" />);
    const panel = screen.getByRole('region', { name: 'Pre-auth observations' });
    expect(within(panel).getByText('Whole app')).toBeInTheDocument();
    expect(within(panel).getByText('POST /login')).toBeInTheDocument();
    expect(within(panel).getByText('37')).toBeInTheDocument();
  });

  it('shows the enforce suggestion with its reason', () => {
    usePreAuthObservations.mockReturnValue(
      ready(
        observations({
          suggestion: {
            status: 'review',
            reason: 'enforce would have rejected 3 requests that succeeded',
            requests: 5000,
            would_block: 49,
            would_block_succeeded: 3,
          },
        })
      )
    );
    render(<EdgeProtectionBody slug="api" />);
    expect(screen.getByText(/review before enforcing/i)).toBeInTheDocument();
    expect(screen.getByText(/rejected 3 requests that succeeded/)).toBeInTheDocument();
  });

  it('says no guard is configured and gives the command when there are no policies', () => {
    usePreAuthObservations.mockReturnValue(ready(observations({ policies: [] })));
    render(<EdgeProtectionBody slug="api" />);
    expect(screen.getByText(/no pre-auth guard is on/i)).toBeInTheDocument();
    expect(screen.getByText('gregale app api --pre-auth observe')).toBeInTheDocument();
  });
});
