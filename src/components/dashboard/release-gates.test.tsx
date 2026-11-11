import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { ReleaseGate } from '@/lib/api/release-gates';

const m = vi.hoisted(() => ({
  create: vi.fn(),
  remove: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  gates: [] as ReleaseGate[],
}));

vi.mock('@/lib/api/release-gates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/release-gates')>()),
  useReleaseGates: () => ({ data: m.gates, error: null, isPending: false, refetch: vi.fn() }),
  useCreateReleaseGate: () => ({ mutateAsync: m.create, isPending: false }),
  useDeleteReleaseGate: () => ({ mutateAsync: m.remove, isPending: false }),
}));
vi.mock('@/lib/api/alert-rules', () => ({
  useAppSLOs: () => ({ data: [{ id: 's1', name: 'checkout' }] }),
  useAppSyntheticChecks: () => ({ data: [{ id: 'k1', name: 'health' }] }),
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapabilityStage: () => 'Preview' }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => m.confirm }));

const { ReleaseGates } = await import('./release-gates');

const gate = (over: Partial<ReleaseGate> = {}): ReleaseGate => ({
  name: 'checkout-slo',
  kind: 'slo',
  slo: 'checkout',
  max_burn_rate: 10,
  min_samples: 20,
  created_by: 'me@acme.dev',
  created_at: '2026-11-01T00:00:00Z',
  ...over,
});

beforeEach(() => {
  m.create.mockReset().mockImplementation(async (body: ReleaseGate) => body);
  m.remove.mockReset().mockResolvedValue(gate());
  m.toast.mockReset();
  m.confirm.mockReset().mockResolvedValue(true);
  m.gates = [];
});

describe('ReleaseGates', () => {
  it('says rollouts still stop on built-in signals without checks, labelled preview', async () => {
    render(<ReleaseGates slug="shop" />);
    const card = screen.getByRole('region', { name: 'Rollout checks' });
    expect(card).toHaveTextContent('Preview');
    expect(card).toHaveTextContent('Built-in only');
    expect(card).toHaveTextContent(/Rollouts stop on server errors, slow responses, crashes/);
    expect(screen.queryByRole('form', { name: 'New release gate' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'About rollout checks' }));
    expect(await screen.findByText(/Also called release gates/)).toBeInTheDocument();
  });

  it('lists each check with what it stops on, the name and kind quieter', () => {
    m.gates = [
      gate(),
      gate({
        name: 'orders-drop',
        kind: 'metric_change',
        metric: 'orders',
        comparison: 'below',
        max_change_percent: 30,
      }),
    ];
    render(<ReleaseGates slug="shop" />);
    expect(screen.getByRole('region', { name: 'Rollout checks' })).toHaveTextContent(
      'Rollouts also stop when any of your 2 checks fails.'
    );
    expect(screen.getByText('Stops on SLO checkout burning faster than 10×')).toBeInTheDocument();
    expect(
      screen.getByText('Stops on orders drops more than 30% from before the rollout')
    ).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Rollout checks' })).toHaveTextContent(
      'orders-drop · Metric change'
    );
  });

  it('keeps minimum samples under Advanced', async () => {
    render(<ReleaseGates slug="shop" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a check' }));
    const form = screen.getByRole('form', { name: 'New release gate' });
    expect(within(form).getByLabelText('Minimum samples')).not.toBeVisible();
    await userEvent.type(within(form).getByLabelText('Name'), 'checkout-slo');
    await userEvent.type(within(form).getByLabelText('SLO'), 'checkout');
    await userEvent.click(within(form).getByText('Advanced'));
    await userEvent.type(within(form).getByLabelText('Minimum samples'), '50');
    await userEvent.click(within(form).getByRole('button', { name: 'Add check' }));
    await waitFor(() =>
      expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ min_samples: 50 }))
    );
  });

  it('adds an SLO gate with only its own fields', async () => {
    render(<ReleaseGates slug="shop" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a check' }));
    const form = screen.getByRole('form', { name: 'New release gate' });
    await userEvent.type(within(form).getByLabelText('Name'), 'checkout-slo');
    await userEvent.type(within(form).getByLabelText('SLO'), 'checkout');
    await userEvent.click(within(form).getByRole('button', { name: 'Add check' }));
    await waitFor(() =>
      expect(m.create).toHaveBeenCalledWith({
        name: 'checkout-slo',
        kind: 'slo',
        slo: 'checkout',
        max_burn_rate: 10,
      })
    );
  });

  it('adds a metric-change gate and a synthetic gate with their defaults', async () => {
    render(<ReleaseGates slug="shop" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a check' }));
    let form = screen.getByRole('form', { name: 'New release gate' });
    await userEvent.type(within(form).getByLabelText('Name'), 'orders-drop');
    await userEvent.selectOptions(within(form).getByLabelText('Kind'), 'metric_change');
    await userEvent.type(within(form).getByLabelText('Custom metric'), 'orders_per_minute');
    await userEvent.click(within(form).getByRole('button', { name: 'Add check' }));
    await waitFor(() =>
      expect(m.create).toHaveBeenLastCalledWith({
        name: 'orders-drop',
        kind: 'metric_change',
        metric: 'orders_per_minute',
        comparison: 'below',
        max_change_percent: 30,
      })
    );
    // The sheet closes on success; the next check opens a fresh one.
    await waitFor(() =>
      expect(screen.queryByRole('form', { name: 'New release gate' })).not.toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add a check' }));
    form = await screen.findByRole('form', { name: 'New release gate' });
    await userEvent.type(within(form).getByLabelText('Name'), 'probe');
    await userEvent.selectOptions(within(form).getByLabelText('Kind'), 'synthetic');
    await userEvent.type(within(form).getByLabelText('Synthetic check'), 'health');
    await userEvent.click(within(form).getByRole('button', { name: 'Add check' }));
    await waitFor(() =>
      expect(m.create).toHaveBeenLastCalledWith({
        name: 'probe',
        kind: 'synthetic',
        check: 'health',
        max_failure_percent: 10,
      })
    );
  });

  it('refuses a name apid would refuse before sending', async () => {
    render(<ReleaseGates slug="shop" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a check' }));
    const form = screen.getByRole('form', { name: 'New release gate' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Bad Name');
    await userEvent.click(within(form).getByRole('button', { name: 'Add check' }));
    expect(within(form).getByText(/Lowercase letters/)).toBeInTheDocument();
    expect(m.create).not.toHaveBeenCalled();
  });

  it('explains the per-app limit', async () => {
    m.create.mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'release_gate_limit', title: 'x' })
    );
    render(<ReleaseGates slug="shop" />);
    await userEvent.click(screen.getByRole('button', { name: 'Add a check' }));
    const form = screen.getByRole('form', { name: 'New release gate' });
    await userEvent.type(within(form).getByLabelText('Name'), 'one-more');
    await userEvent.type(within(form).getByLabelText('SLO'), 'checkout');
    await userEvent.click(within(form).getByRole('button', { name: 'Add check' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(/at most 10 checks/);
  });

  it('removes a gate only after saying rollouts stop judging it', async () => {
    m.gates = [gate()];
    render(<ReleaseGates slug="shop" />);
    m.confirm.mockResolvedValueOnce(false);
    await userEvent.click(screen.getByRole('button', { name: 'Remove checkout-slo' }));
    expect(m.remove).not.toHaveBeenCalled();
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/stop judging it/),
      })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Remove checkout-slo' }));
    await waitFor(() => expect(m.remove).toHaveBeenCalledWith('checkout-slo'));
  });
});
