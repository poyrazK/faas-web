import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlertRollback } from '@/lib/api/alert-rollbacks';

const m = vi.hoisted(() => ({ list: [] as AlertRollback[], read: vi.fn() }));

vi.mock('@/lib/api/alert-rollbacks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/alert-rollbacks')>()),
  useAlertRollbacks: () => ({ data: m.list, error: null, isPending: false, refetch: vi.fn() }),
  useAlertRollback: (_slug: string, fire: string) => {
    m.read(fire);
    return {
      data: m.list.find((r) => r.id === fire),
      error: null,
      isPending: false,
      refetch: vi.fn(),
    };
  },
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapabilityStage: () => 'Preview' }));

const { AlertRollbacks } = await import('./alert-rollbacks');

const base = {
  rule_id: 'rule',
  account_id: 'acct',
  app_id: 'app',
  scope: 'default',
  candidate_deployment_id: 'cccccccc-0000',
  predecessor_deployment_id: 'pppppppp-0000',
  observed_value: 7.4,
  fired_at: '2026-11-03T10:00:00Z',
  updated_at: '2026-11-03T10:01:00Z',
};

beforeEach(() => {
  m.read.mockReset();
  m.list = [
    {
      ...base,
      id: 'f1',
      status: 'blocked',
      reason: 'error_rate_pct > 5 over 5m',
      rollback_phase: 'blocked',
      blockers: [{ code: 'binding_verification_stale', message: 'Retrying with fresh evidence.' }],
    },
    {
      ...base,
      id: 'f2',
      status: 'complete',
      historical: true,
      reason: 'error_rate_pct > 2 over 5m',
      completed_at: '2026-11-03T10:05:00Z',
      deployment_evidence: {
        version: 1,
        deployment_id: 'cccccccc-0000',
        metric: 'error_rate_pct',
        comparison: 'gt',
        threshold: 2,
        window_spec: '5m',
        cutover_at: '2026-11-03T09:50:00Z',
        window_start: '2026-11-03T09:51:00Z',
        window_end: '2026-11-03T09:56:00Z',
        requests: 400,
        server_errors: 20,
        minimum_requests: 20,
        error_rate_pct: 5,
        status: 'breached',
      },
    },
  ];
});

describe('AlertRollbacks', () => {
  it('lists each fire with its status, what fired and which releases it pinned', () => {
    render(<AlertRollbacks slug="shop" />);
    const panel = screen.getByRole('region', { name: 'Automatic rollbacks' });
    expect(panel).toHaveTextContent('Preview');
    const [blocked, done] = within(panel).getAllByRole('listitem');
    expect(blocked).toHaveTextContent('Blocked, will retry');
    expect(blocked).toHaveTextContent('cccccccc → pppppppp');
    expect(done).toHaveTextContent('Rolled back');
    expect(m.read).not.toHaveBeenCalled();
  });

  it('opens a receipt with its blockers, or the evidence behind a completed release’s rollback', async () => {
    render(<AlertRollbacks slug="shop" />);
    const [blocked, done] = screen.getAllByRole('listitem');
    await userEvent.click(within(blocked).getByRole('button', { name: 'Receipt' }));
    expect(m.read).toHaveBeenCalledWith('f1');
    expect(blocked).toHaveTextContent('binding_verification_stale');
    await userEvent.click(within(done).getByRole('button', { name: 'Receipt' }));
    expect(done).toHaveTextContent('Completed release rolled back after cutover');
    expect(done).toHaveTextContent('20 of 400 requests were 5xx (5.0%');
  });

  it('says so when no alert has rolled the app back', () => {
    m.list = [];
    render(<AlertRollbacks slug="shop" />);
    expect(screen.getByText('No alert has rolled this app back.')).toBeInTheDocument();
  });
});
