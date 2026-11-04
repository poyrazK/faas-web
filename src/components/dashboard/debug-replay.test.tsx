import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withRouter } from '@/test/router';
import { ApiError } from '@/lib/api/errors';
import { DebugReplayAction } from './debug-replay';

const hooks = vi.hoisted(() => ({
  confirm: vi.fn(),
  mutate: vi.fn(),
  mirroring: 'off',
  targets: undefined as unknown,
  invocation: undefined as unknown,
  replay: { data: undefined as unknown, error: null as unknown, isPending: false },
}));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => hooks.confirm }));
vi.mock('@/lib/api/capabilities', () => ({
  useCapabilityAccess: () => ({ access: hooks.mirroring, refresh: vi.fn() }),
}));
vi.mock('@/lib/api/debug', () => ({
  useDebugReplay: () => ({ ...hooks.replay, mutate: hooks.mutate }),
  useReplayTargets: (_slug: string, _dep: string, enabled: boolean) => ({
    data: enabled ? hooks.targets : undefined,
    isPending: false,
    error: null,
  }),
}));
vi.mock('@/lib/api/queries', () => ({
  useInvocation: () => ({ data: hooks.invocation, error: null }),
}));

const rule = (mirror: string, percent = 25) => ({
  id: `rule-${mirror}`,
  source_deployment_id: 'dep-source',
  mirror_deployment_id: mirror,
  percent,
  enabled: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  hooks.mirroring = 'off';
  hooks.targets = undefined;
  hooks.invocation = undefined;
  hooks.replay = { data: undefined, error: null, isPending: false };
});

const mount = (extra: Record<string, unknown> = {}) =>
  render(
    withRouter(
      <DebugReplayAction
        slug="api"
        reqId="req-1"
        method="GET"
        route="/orders/{id}"
        deploymentId="dep-source"
        {...extra}
      />
    )
  );

const replay = async () => {
  await act(async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Replay through mirror' }));
  });
};

describe('DebugReplayAction', () => {
  it('says what a replay sends before sending it', async () => {
    hooks.confirm.mockResolvedValue(true);
    mount();
    await replay();
    const asked = hooks.confirm.mock.calls[0][0];
    expect(asked.title).toBe('Replay GET /orders/{id} through its mirror?');
    expect(asked.description).toMatch(/empty body and no credentials/);
    expect(asked.description).toMatch(/can happen again/);
    // Without mirror rules to read, apid picks the serving deployment's rule.
    expect(hooks.mutate).toHaveBeenCalledWith({ reqId: 'req-1', mirrorDeploymentId: undefined });
  });

  it('sends nothing when the person declines', async () => {
    hooks.confirm.mockResolvedValue(false);
    mount();
    await replay();
    expect(hooks.mutate).not.toHaveBeenCalled();
  });

  it('replays to the mirror target chosen among the serving deployment’s rules', async () => {
    hooks.mirroring = 'on';
    hooks.targets = [rule('mirror-aaaaaaaa'), rule('mirror-bbbbbbbb', 50)];
    hooks.confirm.mockResolvedValue(true);
    mount();
    fireEvent.change(await screen.findByLabelText('Mirror target'), {
      target: { value: 'mirror-bbbbbbbb' },
    });
    await replay();
    expect(hooks.confirm.mock.calls[0][0].description).toMatch(
      /50% of this deployment's traffic to deployment mirror-b/
    );
    expect(hooks.mutate).toHaveBeenCalledWith({
      reqId: 'req-1',
      mirrorDeploymentId: 'mirror-bbbbbbbb',
    });
  });

  it('offers no replay when no enabled rule takes the serving deployment’s traffic', async () => {
    hooks.mirroring = 'on';
    hooks.targets = [];
    mount();
    expect(await screen.findByText(/cannot be replayed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Replay through mirror' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Set up a mirror rule' })).toHaveAttribute(
      'href',
      '/dashboard/apps/api?tab=Mirrors'
    );
  });

  it('follows the queued replay to its end and offers to compare the two deployments', async () => {
    const onCompare = vi.fn();
    hooks.replay.data = {
      status: 'queued',
      mirror_invocation_id: 'inv-9',
      source_deployment_id: 'dep-source',
      mirror_deployment_id: 'mirror-aaaaaaaa',
    };
    hooks.invocation = { id: 'inv-9', state: 'completed' };
    mount({ onCompare });
    expect(await screen.findByText(/Replay queued/)).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Follow the replay' })).toHaveAttribute(
      'href',
      '/dashboard/invocations?invocation=inv-9'
    );
    fireEvent.click(screen.getByRole('button', { name: /compare deployment dep-sour/i }));
    expect(onCompare).toHaveBeenCalledWith('dep-source', 'mirror-aaaaaaaa');
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

  it('says when the request’s telemetry is gone', async () => {
    hooks.replay.error = new ApiError({ status: 404, code: 'not_found', title: 'Not found' });
    mount();
    expect(await screen.findByText(/no longer retained/)).toBeInTheDocument();
  });
});
