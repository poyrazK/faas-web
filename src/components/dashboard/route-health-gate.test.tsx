import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import type { RouteHealthGate } from '@/lib/api/route-health';

const m = vi.hoisted(() => ({
  save: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  gate: null as RouteHealthGate | null,
}));

vi.mock('@/lib/api/route-health', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/route-health')>()),
  useRouteHealthGate: () => ({ data: m.gate, error: null, isPending: false, refetch: vi.fn() }),
  useSetRouteHealthGate: () => ({ mutateAsync: m.save, isPending: false }),
}));
vi.mock('@/lib/api/capabilities', () => ({ useCapabilityStage: () => 'Preview' }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => m.confirm }));

const { RouteHealthGatePanel } = await import('./route-health-gate');

const GATE: RouteHealthGate = {
  app_id: 'app',
  mode: 'report',
  on_regression: 'hold',
  revision: 3,
  routes: [{ method: 'POST', path: '/checkout', max_p95_ms: 500 }],
};

beforeEach(() => {
  m.gate = { ...GATE };
  m.save.mockReset().mockImplementation(async (body) => ({ ...GATE, ...body, revision: 4 }));
  m.toast.mockReset();
  m.confirm.mockReset().mockResolvedValue(true);
});

describe('RouteHealthGatePanel', () => {
  it('shows the mode, recovery, revision and each route’s checks, labelled preview', () => {
    render(<RouteHealthGatePanel slug="shop" />);
    const panel = screen.getByRole('region', { name: 'Critical route health' });
    expect(panel).toHaveTextContent('Preview');
    expect(panel).toHaveTextContent('Revision 3');
    expect(panel).toHaveTextContent('POST /checkout');
    expect(panel).toHaveTextContent('p95 ≤ 500 ms');
  });

  it('enforces after a confirmation and saves at the revision it read', async () => {
    render(<RouteHealthGatePanel slug="shop" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit routes' }));
    const form = screen.getByRole('form', { name: 'Route health guard' });
    await userEvent.click(within(form).getByRole('button', { name: 'Enforce' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Abort and restore' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Add route' }));
    await userEvent.clear(within(form).getByLabelText('Route 2 path'));
    await userEvent.type(within(form).getByLabelText('Route 2 path'), '/profiles/{{id}');
    await userEvent.type(within(form).getByLabelText('Route 2 probe path'), '/profiles/42');
    await userEvent.click(within(form).getByRole('button', { name: 'Save guard' }));
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(
          /held for 24 hours is aborted.*Two confirmed 5xx windows/s
        ),
      })
    );
    await waitFor(() =>
      expect(m.save).toHaveBeenCalledWith({
        mode: 'enforce',
        on_regression: 'abort',
        expected_revision: 3,
        routes: [
          { method: 'POST', path: '/checkout', max_p95_ms: 500 },
          { method: 'GET', path: '/profiles/{id}', probe: { path: '/profiles/42' } },
        ],
      })
    );
  });

  it('refuses enforce without routes, and recovery without enforce', async () => {
    m.gate = { ...GATE, routes: [] };
    render(<RouteHealthGatePanel slug="shop" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit routes' }));
    const form = screen.getByRole('form', { name: 'Route health guard' });
    await userEvent.click(within(form).getByRole('button', { name: 'Abort and restore' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save guard' }));
    expect(within(form).getByText('Automatic recovery needs enforce mode.')).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Enforce' }));
    expect(within(form).getByText('Enforce needs at least one route.')).toBeInTheDocument();
    expect(m.save).not.toHaveBeenCalled();
  });

  it('says when someone else saved first, and shows the save’s warnings', async () => {
    m.save.mockRejectedValueOnce(new ApiError({ status: 409, code: 'conflict', title: 'x' }));
    render(<RouteHealthGatePanel slug="shop" />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit routes' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save guard' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Someone changed the guard/);
    m.save.mockResolvedValueOnce({
      ...GATE,
      revision: 4,
      warnings: ['POST /checkout had no requests in 7 days'],
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save guard' }));
    expect(await screen.findByRole('status', { name: 'Warnings from the save' })).toHaveTextContent(
      'POST /checkout had no requests in 7 days'
    );
  });
});
