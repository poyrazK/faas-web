import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EdgeRule } from '@/lib/api/queries';
import { ApiError } from '@/lib/api/errors';

const state = vi.hoisted(() => ({
  data: undefined as unknown,
  error: null as unknown,
  update: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/edge-rules', () => ({
  useEdgeWAFReview: () => ({
    data: state.data,
    error: state.error,
    isPending: false,
    refetch: vi.fn(),
  }),
  useUpdateWAFExclusions: () => ({ mutateAsync: state.update, isPending: false }),
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));

const { EdgeWAFReview } = await import('./edge-waf-review');

const waf: EdgeRule = {
  id: 'w1',
  account_id: 'acct',
  app_id: 'app',
  name: 'API WAF',
  match_host: '@app',
  match_path: '/api/**',
  match_methods: [],
  match_headers: {},
  priority: 50,
  enabled: true,
  kind: 'waf',
  action: { mode: 'block', exclude_rule_ids: [920350] },
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

const group = (over: Record<string, unknown>) => ({
  rule_id: 'w1',
  rule_name: 'API WAF',
  rule_mode: 'block',
  crs_rule_id: 942100,
  category: 'sqli',
  path: '/api/search',
  events: 40,
  detected: 0,
  warned: 0,
  blocked: 40,
  clients: 12,
  top_client_percent: 9,
  scanner_percent: 0,
  first_seen: '2026-10-28T10:00:00Z',
  last_seen: '2026-10-30T10:00:00Z',
  request_ids: ['req-1'],
  excluded: false,
  assessment: 'likely_false_positive',
  reason: '12 clients were flagged on this path and none sent most of the detections',
  ...over,
});

beforeEach(() => {
  state.data = {
    since: '2026-10-24T00:00:00Z',
    scanned: 52,
    truncated: false,
    groups: [
      group({}),
      group({
        crs_rule_id: 920350,
        category: 'protocol',
        path: '/api/{id}',
        excluded: true,
        assessment: 'excluded',
        reason: 'the rule excludes CRS 920350 now',
      }),
    ],
  };
  state.error = null;
  state.update.mockReset().mockResolvedValue(waf);
  state.confirm.mockReset().mockResolvedValue(true);
  state.toast.mockReset();
});

describe('EdgeWAFReview', () => {
  it('groups detections by rule, CRS rule and path, with the assessment and why', () => {
    render(<EdgeWAFReview slug="api" rules={[waf]} />);
    const fp = screen.getByRole('group', { name: 'CRS 942100 on /api/search' });
    expect(within(fp).getByText('likely false positive')).toBeInTheDocument();
    expect(within(fp).getByText(/12 clients were flagged/)).toBeInTheDocument();
    expect(within(fp).getByText(/40 blocked/)).toBeInTheDocument();
    expect(screen.getByText(/counts are lower bounds/)).toBeInTheDocument();
  });

  it('says exactly what an exclusion lets through before adding it', async () => {
    render(<EdgeWAFReview slug="api" rules={[waf]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Exclude CRS 942100 from API WAF' }));
    const asked = state.confirm.mock.calls[0][0];
    expect(asked).toMatchObject({
      title: 'Exclude CRS 942100 from API WAF?',
      confirmLabel: 'Exclude',
      destructive: true,
    });
    expect(asked.description).toContain('@app/api/**');
    expect(asked.description).toContain('every path the rule covers, not only /api/search');
    expect(asked.description).toMatch(/sqli/);
    await waitFor(() => expect(state.update).toHaveBeenCalledWith({ id: 'w1', add: [942100] }));
  });

  it('warns harder when the detections look like an attack', async () => {
    state.data = {
      ...(state.data as object),
      groups: [group({ assessment: 'likely_attack', scanner_percent: 80, reason: 'scanners' })],
    };
    render(<EdgeWAFReview slug="api" rules={[waf]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Exclude CRS 942100 from API WAF' }));
    expect(state.confirm.mock.calls[0][0].description).toMatch(/look like an attack/);
  });

  it('adds nothing when the confirmation is declined', async () => {
    state.confirm.mockResolvedValue(false);
    render(<EdgeWAFReview slug="api" rules={[waf]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Exclude CRS 942100 from API WAF' }));
    expect(state.update).not.toHaveBeenCalled();
  });

  it('puts an excluded CRS rule back', async () => {
    render(<EdgeWAFReview slug="api" rules={[waf]} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Score CRS 920350 again in API WAF' })
    );
    expect(state.confirm.mock.calls[0][0]).toMatchObject({ destructive: false });
    await waitFor(() => expect(state.update).toHaveBeenCalledWith({ id: 'w1', remove: [920350] }));
  });

  it('offers no exclusion for a rule that is gone', () => {
    render(<EdgeWAFReview slug="api" rules={[]} />);
    expect(screen.queryByRole('button', { name: /Exclude/ })).toBeNull();
  });

  it('reports a refused exclusion', async () => {
    state.update.mockRejectedValue(
      new ApiError({ status: 422, code: 'validation_failed', title: 'Bad', detail: 'at most 50' })
    );
    render(<EdgeWAFReview slug="api" rules={[waf]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Exclude CRS 942100 from API WAF' }));
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', description: 'at most 50' })
      )
    );
  });

  it('says when there is nothing to review', () => {
    state.data = { since: '2026-10-24T00:00:00Z', scanned: 0, truncated: false, groups: [] };
    render(<EdgeWAFReview slug="api" rules={[waf]} />);
    expect(screen.getByText(/No WAF detections/)).toBeInTheDocument();
  });
});
