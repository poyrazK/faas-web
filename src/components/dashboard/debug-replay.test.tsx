import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';
import { DebugReplayAction } from './debug-replay';

const hooks = vi.hoisted(() => ({
  confirm: vi.fn(),
  mutate: vi.fn(),
  replay: { data: undefined as unknown, error: null as unknown, isPending: false },
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => hooks.confirm }));
vi.mock('@/lib/api/debug', () => ({
  useDebugReplay: () => ({ ...hooks.replay, mutate: hooks.mutate }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  hooks.replay = { data: undefined, error: null, isPending: false };
});

const mount = () =>
  render(
    withRouter(<DebugReplayAction slug="api" reqId="req-1" method="GET" route="/orders/{id}" />)
  );

describe('DebugReplayAction', () => {
  it('says what a replay sends before sending it', async () => {
    hooks.confirm.mockResolvedValue(true);
    mount();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Replay through mirror' }));
    });
    const asked = hooks.confirm.mock.calls[0][0];
    expect(asked.title).toBe('Replay GET /orders/{id} through its mirror?');
    expect(asked.description).toMatch(/empty body and no credentials/);
    expect(asked.description).toMatch(/can happen again/);
    expect(hooks.mutate).toHaveBeenCalledWith('req-1');
  });

  it('sends nothing when the person declines', async () => {
    hooks.confirm.mockResolvedValue(false);
    mount();
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Replay through mirror' }));
    });
    expect(hooks.mutate).not.toHaveBeenCalled();
  });

  it('links the queued replay to its invocation', async () => {
    hooks.replay.data = { status: 'queued', mirror_invocation_id: 'inv-9' };
    mount();
    expect(await screen.findByText(/Replay queued/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Follow the replay' })).toHaveAttribute(
      'href',
      '/dashboard/invocations?invocation=inv-9'
    );
  });

  it('points at mirror rules when no mirror targets the serving deployment', async () => {
    hooks.replay.error = new ApiError({
      status: 409,
      code: 'debug_replay_unsupported',
      title: 'Debug replay is unavailable',
      detail: "the request's serving deployment has no enabled mirror rule",
    });
    mount();
    expect(await screen.findByText(/no enabled mirror rule/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up a mirror rule' })).toHaveAttribute(
      'href',
      '/dashboard/apps/api?tab=Mirrors'
    );
  });
});
