import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const useMirrorRules = vi.fn();
const useMirrorSummary = vi.fn();
const useDeployments = vi.fn();
const useApp = vi.fn();
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useMirrorRules: (slug: string) => useMirrorRules(slug) as unknown,
  useMirrorSummary: (slug: string, id: string, window: string) =>
    useMirrorSummary(slug, id, window) as unknown,
  useDeployments: (limit: number) => useDeployments(limit) as unknown,
  useApp: (slug: string) => useApp(slug) as unknown,
  useCreateMirrorRule: () => ({ mutateAsync: create, isPending: false }),
  useUpdateMirrorRule: () => ({ mutateAsync: update, isPending: false }),
  useDeleteMirrorRule: () => ({ mutateAsync: remove, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));

const { MirrorRules, latencyDirection } = await import('./mirrors');

const ready = (data: unknown) => ({ data, isPending: false, error: null, refetch: vi.fn() });
const dep = (id: string, status = 'live') => ({
  id,
  app_id: 'app1',
  image_digest: 'sha256:x',
  kind: 'github',
  status,
  created_at: '2026-09-06T10:00:00Z',
  rollback_on_5xx: false,
  first_5xx_count: 0,
});
const rule = {
  id: 'rule1abc',
  account_id: 'acct',
  app_id: 'app1',
  source_deployment_id: 'aaaaaaaa1111',
  mirror_deployment_id: 'bbbbbbbb2222',
  percent: 25,
  enabled: true,
  include_body: false,
  redact_headers: ['X-Tenant-Id'],
  always_stripped_headers: ['Authorization'],
  created_at: '2026-09-05T10:00:00Z',
  updated_at: '2026-09-05T10:00:00Z',
};
const summary = {
  total_invocations: 420,
  status_diff_count: 5,
  schema_diff_count: 2,
  body_diff_count: 0,
  mean_latency_diff_ms: 12.4,
  p99_latency_diff_ms: -8.1,
  crash_count: 0,
  window_seconds: 3600,
};

beforeEach(() => {
  useMirrorRules.mockReset().mockReturnValue(ready({ rules: [rule], count: 1 }));
  useMirrorSummary.mockReset().mockReturnValue(ready(summary));
  useDeployments.mockReset().mockReturnValue(
    ready({
      items: [dep('aaaaaaaa1111'), dep('bbbbbbbb2222'), dep('cccccccc3333', 'superseded')],
    })
  );
  useApp.mockReset().mockReturnValue(ready({ id: 'app1', slug: 'api' }));
  create.mockReset().mockResolvedValue(rule);
  update.mockReset().mockResolvedValue(rule);
  remove.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
});

describe('latencyDirection', () => {
  it('turns the signed delta into a direction, never an absolute', () => {
    expect(latencyDirection(12.4)).toBe('mirror 12 ms slower');
    expect(latencyDirection(-8.1)).toBe('mirror 8 ms faster');
    expect(latencyDirection(0.2)).toBe('no difference');
  });
});

describe('MirrorRules', () => {
  it('shows each rule with its share and the drift summary as directions', () => {
    render(<MirrorRules slug="api" />);
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText('mirror 12 ms slower')).toBeInTheDocument();
    expect(screen.getByText(/mirror 8 ms faster at p99/)).toBeInTheDocument();
    expect(screen.getByText('X-Tenant-Id')).toBeInTheDocument();
  });

  it('creates a rule from two live deployments with the parsed redact list', async () => {
    render(<MirrorRules slug="api" />);
    await userEvent.type(screen.getByPlaceholderText(/X-Tenant-Id/), 'X-Trace, X-Debug');
    await userEvent.click(screen.getByRole('button', { name: /add mirror/i }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        source_deployment_id: 'aaaaaaaa1111',
        mirror_deployment_id: 'bbbbbbbb2222',
        percent: 100,
        include_body: false,
        redact_headers: ['X-Trace', 'X-Debug'],
      })
    );
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
  });

  it('reads 403 plan_mirror_not_allowed as a plan gate, not a failure', async () => {
    create.mockRejectedValue(
      new ApiError({ status: 403, code: 'plan_mirror_not_allowed', title: 'Forbidden' })
    );
    render(<MirrorRules slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /add mirror/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'info', title: 'Not on your plan' })
    );
  });

  it('explains a 409 as the deployments not both being live', async () => {
    create.mockRejectedValue(
      new ApiError({ status: 409, code: 'mirror_deployment_not_live', title: 'Conflict' })
    );
    render(<MirrorRules slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /add mirror/i }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', title: 'Both deployments must be live' })
    );
  });

  it('confirms before deleting a rule', async () => {
    render(<MirrorRules slug="api" />);
    await userEvent.click(screen.getByRole('button', { name: /delete mirror rule/i }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }))
    );
    expect(remove).toHaveBeenCalledWith('rule1abc');
  });

  it('toggles a rule without a confirm, since disabling is reversible', async () => {
    render(<MirrorRules slug="api" />);
    await userEvent.click(screen.getByRole('switch', { name: /mirror rule rule1abc enabled/i }));
    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 'rule1abc', enabled: false }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('says why a rule cannot be created when fewer than two deployments are live', () => {
    useDeployments.mockReturnValue(ready({ items: [dep('aaaaaaaa1111')] }));
    render(<MirrorRules slug="api" />);
    expect(screen.getByText(/there is one right now/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add mirror/i })).not.toBeInTheDocument();
  });
});
