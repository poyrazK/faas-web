import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EdgeRule } from '@/lib/api/queries';
import { KINDS } from './kinds';

/** The challenge kind and the penalty box in the rule dialog. */

const state = vi.hoisted(() => ({
  released: new Set<string>(['edge-browser-challenge', 'edge-penalty-box']),
  plan: 'pro',
  create: vi.fn(),
  update: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/lib/api/queries', () => ({
  useCreateEdgeRule: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateEdgeRule: () => ({ mutateAsync: state.update, isPending: false }),
  useThrottleSuggestions: () => ({ data: undefined, isPending: false, error: null }),
}));
vi.mock('@/lib/auth', () => ({
  useAuth: () => ({ account: { id: 'acct', plan: state.plan } }),
}));
vi.mock('@/lib/api/capabilities', () => ({
  useCapability: (key: string) => ({
    accountId: 'acct',
    state: key === 'declarative-response-caching' ? 'available' : 'unknown',
    refresh: vi.fn(),
  }),
  useCapabilityAccess: (key: string) => ({ access: state.released.has(key) ? 'on' : 'off' }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/dashboard/plans">{children}</a>,
}));

const { EdgeRuleDialog } = await import('./dialog');

const ipRule: EdgeRule = {
  id: 'ip-1',
  account_id: 'acct',
  app_id: 'app-1',
  kind: 'ip',
  match_host: '*',
  match_path: '/admin/*',
  match_methods: [],
  match_headers: {},
  priority: 10,
  enabled: true,
  action: { deny: ['0.0.0.0/0'] },
  penalty: { seconds: 600, after: 3, within_seconds: 60 },
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
};

function mount(rule: EdgeRule | null = null) {
  return render(
    <EdgeRuleDialog
      open
      onClose={vi.fn()}
      rule={rule}
      slug="api"
      apps={[{ slug: 'api' }]}
      nextPriority={10}
    />
  );
}

beforeEach(() => {
  state.released = new Set(['edge-browser-challenge', 'edge-penalty-box']);
  state.plan = 'pro';
  state.create.mockReset().mockResolvedValue({});
  state.update.mockReset().mockResolvedValue({});
  state.toast.mockReset();
});

describe('challenge kind', () => {
  it('summarises and validates within apid bounds', () => {
    expect(KINDS.challenge.summary({})).toBe('difficulty 16 · pass 60 min');
    expect(
      KINDS.challenge.summary({ difficulty: 14, max_difficulty: 20, pass_ttl_seconds: 600 })
    ).toBe('difficulty 14–20 · pass 10 min');
    expect(KINDS.challenge.validate({ difficulty: 9 })).toHaveProperty('difficulty');
    expect(KINDS.challenge.validate({ difficulty: 23 })).toHaveProperty('difficulty');
    expect(KINDS.challenge.validate({ pass_ttl_seconds: 299 })).toHaveProperty('pass_ttl_seconds');
    expect(KINDS.challenge.validate({ difficulty: 16, max_difficulty: 14 })).toHaveProperty(
      'max_difficulty'
    );
    expect(KINDS.challenge.validate(KINDS.challenge.empty())).toEqual({});
  });

  it('creates a challenge rule once challenges are released to the account', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Browser challenge/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'challenge',
          action: { difficulty: 16, pass_ttl_seconds: 3600 },
        })
      )
    );
  });

  it('is not offered before release: apid would refuse it', async () => {
    state.released.delete('edge-browser-challenge');
    mount();
    const challenge = screen.getByRole('button', { name: /Browser challenge/ });
    expect(challenge).toHaveAttribute('aria-disabled', 'true');
    expect(challenge).toHaveTextContent('Not released to this account yet.');
  });
});

describe('penalty box', () => {
  it('adds a penalty to a new ip rule', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /IP allow or deny/ }));
    await userEvent.click(screen.getByRole('switch', { name: 'Penalty box' }));
    const seconds = screen.getByLabelText(/^Block for \(seconds\)/);
    await userEvent.clear(seconds);
    await userEvent.type(seconds, '900');
    await userEvent.type(screen.getByLabelText(/^Deny/), '10.0.0.0/8{enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    await waitFor(() =>
      expect(state.create).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'ip',
          penalty: { seconds: 900, after: 1, within_seconds: 60 },
        })
      )
    );
  });

  it('refuses a penalty outside 60 s to 24 h before the round trip', async () => {
    mount(ipRule);
    const seconds = screen.getByLabelText(/^Block for \(seconds\)/);
    await userEvent.clear(seconds);
    await userEvent.type(seconds, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText('From 60 to 86400 seconds.')).toBeInTheDocument();
    expect(state.update).not.toHaveBeenCalled();
  });

  it('clears a penalty with clear_penalty, and leaves an untouched one out', async () => {
    const view = mount(ipRule);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(state.update).toHaveBeenCalledTimes(1));
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('penalty');
    expect(state.update.mock.calls[0][0]).not.toHaveProperty('clear_penalty');
    view.unmount();
    mount(ipRule);
    await userEvent.click(screen.getByRole('switch', { name: 'Penalty box' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(state.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'ip-1', clear_penalty: true })
      )
    );
  });

  it('is not offered on kinds that never refuse a client', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Rewrite the path/ }));
    expect(screen.queryByRole('switch', { name: 'Penalty box' })).toBeNull();
  });

  it('is not offered before release, but an existing penalty can still be removed', async () => {
    state.released.delete('edge-penalty-box');
    mount();
    await userEvent.click(screen.getByRole('button', { name: /IP allow or deny/ }));
    expect(screen.queryByRole('switch', { name: 'Penalty box' })).toBeNull();
  });

  it('still lets an existing penalty be removed before release', () => {
    state.released.delete('edge-penalty-box');
    mount(ipRule);
    expect(screen.getByRole('switch', { name: 'Penalty box' })).toBeChecked();
  });
});
