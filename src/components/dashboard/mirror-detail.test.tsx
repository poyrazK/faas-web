import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const m = vi.hoisted(() => ({
  update: vi.fn(),
  replay: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  rule: {} as Record<string, unknown>,
}));

vi.mock('@/lib/api/queries', () => ({
  useUpdateMirrorRule: () => ({ mutateAsync: m.update, isPending: false }),
}));
vi.mock('@/lib/api/mirror-replay', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/mirror-replay')>()),
  useMirrorRule: () => ({ data: m.rule, error: null, isPending: false, refetch: vi.fn() }),
  useReplayMirror: () => ({ mutateAsync: m.replay, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => m.confirm }));

const { MirrorRuleDetail } = await import('./mirror-detail');

const RULE = {
  id: 'r1',
  account_id: 'a',
  app_id: 'app',
  source_deployment_id: 'aaaaaaaa-1111',
  mirror_deployment_id: 'bbbbbbbb-2222',
  percent: 10,
  enabled: true,
  include_body: false,
  allow_unsafe_methods: false,
  redact_headers: ['X-Tenant-Id'],
  always_stripped_headers: ['Authorization', 'Cookie', 'Set-Cookie'],
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
};

beforeEach(() => {
  m.rule = { ...RULE };
  m.update.mockReset().mockResolvedValue(RULE);
  m.replay.mockReset().mockResolvedValue({
    queued: 1,
    invocations: [{ request_id: 'req-1', mirror_invocation_id: 'inv-12345678', status: 'queued' }],
  });
  m.toast.mockReset();
  m.confirm.mockReset().mockResolvedValue(true);
});

describe('MirrorRuleDetail', () => {
  it('shows what the gateway always strips and which methods are mirrored', () => {
    render(<MirrorRuleDetail slug="shop" id="r1" />);
    const detail = screen.getByRole('region', { name: 'Mirror rule detail' });
    expect(detail).toHaveTextContent('Authorization, Cookie, Set-Cookie');
    expect(detail).toHaveTextContent('GET, HEAD and OPTIONS only');
  });

  it('changes the share without asking, and asks before mirroring writes', async () => {
    render(<MirrorRuleDetail slug="shop" id="r1" />);
    const form = screen.getByRole('form', { name: 'Mirror settings' });
    await userEvent.clear(within(form).getByRole('spinbutton'));
    await userEvent.type(within(form).getByRole('spinbutton'), '25');
    await userEvent.click(within(form).getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(m.update).toHaveBeenCalledWith({ id: 'r1', percent: 25 }));
    expect(m.confirm).not.toHaveBeenCalled();
    m.confirm.mockResolvedValueOnce(false);
    await userEvent.click(within(form).getByRole('switch', { name: 'Mirror writes' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save settings' }));
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        destructive: true,
        description: expect.stringMatching(/happens for real/),
      })
    );
    expect(m.update).toHaveBeenCalledTimes(1);
  });

  it('replays a corpus against the mirror after a confirmation and links each invocation', async () => {
    render(<MirrorRuleDetail slug="shop" id="r1" />);
    const corpus = screen.getByRole('textbox', { name: 'Requests to replay' });
    await userEvent.click(corpus);
    await userEvent.paste('[{"method":"GET","path":"/orders"}]');
    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(m.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Replay 1 request against bbbbbbbb?' })
    );
    await waitFor(() =>
      expect(m.replay).toHaveBeenCalledWith({
        id: 'r1',
        requests: [{ method: 'GET', path: '/orders' }],
        allowUnsafe: false,
      })
    );
    expect(await screen.findByRole('link', { name: 'inv-1234' })).toHaveAttribute(
      'href',
      '/dashboard/invocations?invocation=inv-12345678'
    );
  });

  it('needs an acknowledgement before replaying writes', async () => {
    render(<MirrorRuleDetail slug="shop" id="r1" />);
    await userEvent.click(screen.getByRole('textbox', { name: 'Requests to replay' }));
    await userEvent.paste('[{"method":"POST","path":"/orders","body":{"n":1}}]');
    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(screen.getByText(/Acknowledge that writes/)).toBeInTheDocument();
    expect(m.confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('checkbox', { name: /send them to the mirror anyway/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await waitFor(() =>
      expect(m.replay).toHaveBeenCalledWith(expect.objectContaining({ allowUnsafe: true }))
    );
  });

  it('explains a disabled rule', async () => {
    m.rule = { ...RULE, enabled: false };
    m.replay.mockRejectedValue(
      new ApiError({ status: 409, code: 'debug_replay_unsupported', title: 'x' })
    );
    render(<MirrorRuleDetail slug="shop" id="r1" />);
    expect(screen.getByText(/enable it to replay/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });
});
