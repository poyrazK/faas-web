import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';

const createPersonal = vi.fn();
const createOrg = vi.fn();
const rotatePersonal = vi.fn();
const rotateOrg = vi.fn();
const revokePersonal = vi.fn();
const revokeOrg = vi.fn();
const toast = vi.fn();
const policy = vi.fn();
let reduce = false;

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('motion/react', async (original) => ({
  ...(await original<object>()),
  useReducedMotion: () => reduce,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
const key = {
  id: 'k1',
  label: 'CI',
  prefix: 'fp_live_old',
  scopes: ['apps:read'],
  last_used_at: null,
};
vi.mock('@/lib/api/queries', () => ({
  useApiKeys: () => ({ data: [key], isPending: false, error: null, refetch: vi.fn() }),
  useOrgKeys: () => ({ data: { keys: [key] }, isPending: false, error: null, refetch: vi.fn() }),
  useCreateApiKey: () => ({ mutateAsync: createPersonal, isPending: false, reset: vi.fn() }),
  useCreateOrgKey: () => ({ mutateAsync: createOrg, isPending: false, reset: vi.fn() }),
  useRotateApiKey: () => ({ mutateAsync: rotatePersonal, isPending: false, reset: vi.fn() }),
  useRotateOrgKey: () => ({ mutateAsync: rotateOrg, isPending: false, reset: vi.fn() }),
  useDeleteApiKey: () => ({ mutateAsync: revokePersonal, isPending: false }),
  useDeleteOrgKey: () => ({ mutateAsync: revokeOrg, isPending: false }),
  useGraceWindow: () => policy(),
  useSetGraceWindow: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { Route } = await import('@/routes/dashboard.keys');
const Personal = (Route as unknown as { component: React.ComponentType }).component;
const { OrgKeysPanel } = await import('./org-panels');

beforeEach(() => {
  reduce = true;
  policy.mockReturnValue({ data: { days: 0, plan_default: 7 }, isPending: false, error: null });
  createPersonal.mockReset().mockResolvedValue({ plaintext: 'personal-secret-once' });
  createOrg.mockReset().mockResolvedValue({ plaintext: 'org-secret-once' });
  rotatePersonal.mockReset().mockResolvedValue({ key_plaintext: 'personal-rotated-once' });
  rotateOrg.mockReset().mockResolvedValue({ key_plaintext: 'org-rotated-once' });
  revokePersonal.mockReset().mockResolvedValue(undefined);
  revokeOrg.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
});

describe.each([
  {
    name: 'personal',
    View: Personal,
    create: createPersonal,
    rotate: rotatePersonal,
    revoke: revokePersonal,
    days: 0,
    scopes: ['apps:read', 'deploy:write'],
  },
  {
    name: 'org',
    View: () => <OrgKeysPanel slug="acme" />,
    create: createOrg,
    rotate: rotateOrg,
    revoke: revokeOrg,
    days: 7,
    scopes: ['deploy:write', 'apps:read'],
  },
])('$name key interactions', ({ name, View, create, rotate, revoke, days, scopes }) => {
  function show() {
    return render(
      <ConfirmProvider>
        <View />
      </ConfirmProvider>
    );
  }
  async function open() {
    await userEvent.click(screen.getByRole('button', { name: 'Create key', expanded: false }));
    return screen.getByRole('region', { name: 'Create a key' });
  }

  it('keeps stored prefixes primary and opens/closes the form from the keyboard', async () => {
    show();
    expect(screen.getByText('fp_live_old…')).toBeVisible();
    expect(screen.queryByRole('textbox', { name: 'Label' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: 'Create key' });
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Label' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(create).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'uses reduced-motion-safe entrance (reduce=%s) without delaying close',
    async (reduced) => {
      reduce = reduced;
      show();
      expect(screen.getByRole('button', { name: 'Create key' })).toHaveAttribute(
        'aria-expanded',
        'false'
      );
      fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
      const region = screen.getByRole('region', { name: 'Create a key' });
      expect(region.style.opacity).toBe(reduced ? '1' : '0');
      fireEvent.click(within(region).getByRole('button', { name: 'Close Create a key' }));
      expect(region).not.toBeInTheDocument();
    }
  );

  it('explains the effective grace window and its scope before creating', async () => {
    show();
    const region = await open();
    expect(
      within(region).getByText(new RegExp(`Effective grace window: ${days} days`))
    ).toBeVisible();
    expect(
      within(region).getByText(
        name === 'personal'
          ? /account-wide.*future rotations/i
          : /organisation rotations.*plan default/i
      )
    ).toBeVisible();
  });

  it('never inserts a freshly created plaintext into the masked DOM or accessible attributes', async () => {
    const view = show();
    if (!screen.queryByRole('textbox', { name: 'Label' })) await open();
    await userEvent.type(screen.getByRole('textbox', { name: 'Label' }), 'release{Enter}');
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(view.container.innerHTML).not.toContain(`${name}-secret-once`);
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeVisible();
  });

  it('rejects labels beyond the API limit with inline focus and allows a corrected retry', async () => {
    show();
    const region = await open();
    const label = within(region).getByRole('textbox', { name: 'Label' });
    fireEvent.change(label, { target: { value: 'x'.repeat(101) } });
    await userEvent.click(within(region).getByRole('button', { name: 'Create key' }));
    expect(create).not.toHaveBeenCalled();
    expect(label).toHaveFocus();
    expect(label).toHaveAccessibleDescription(/100 characters/);
    await userEvent.clear(label);
    await userEvent.type(label, 'fixed{Enter}');
    await screen.findByRole('button', { name: 'Reveal' });
    expect(create).toHaveBeenCalledWith({ label: 'fixed', scopes });
  });

  it('copies while masked, reveals/hides explicitly and discards plaintext on dismiss', async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText');
    const view = show();
    const region = await open();
    await user.type(within(region).getByRole('textbox', { name: 'Label' }), 'release');
    await user.click(within(region).getByRole('button', { name: 'Create key' }));
    const secret = `${name}-secret-once`;
    await screen.findByRole('button', { name: 'Reveal' });
    expect(create).toHaveBeenCalledWith({ label: 'release', scopes });
    expect(view.container.innerHTML).not.toContain(secret);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(copy).toHaveBeenCalledWith(secret);
    expect(view.container.innerHTML).not.toContain(secret);
    await user.click(screen.getByRole('button', { name: 'Reveal' }));
    expect(screen.getByText(secret)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(view.container.innerHTML).not.toContain(secret);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Label' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Close Create a key' }));
    await open();
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('clears revealed evidence on close and remount', async () => {
    const view = show();
    const region = await open();
    await userEvent.type(within(region).getByRole('textbox', { name: 'Label' }), 'release{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: 'Reveal' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close Create a key' }));
    expect(view.container.innerHTML).not.toContain(`${name}-secret-once`);
    await open();
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
    view.unmount();
    show();
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
  });

  it('does not resurface a late response after the interaction closes', async () => {
    let resolve!: (result: { plaintext: string }) => void;
    create.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    show();
    const region = await open();
    await userEvent.type(within(region).getByRole('textbox', { name: 'Label' }), 'release{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Close Create a key' }));
    resolve({ plaintext: 'late-secret' });
    await open();
    expect(screen.queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
  });

  it('shows the effective grace before rotation and preserves cancel/revoke actions', async () => {
    show();
    await userEvent.click(
      screen.getByRole('button', { name: name === 'personal' ? 'Rotate CI' : 'Rotate key CI' })
    );
    let dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAccessibleDescription(new RegExp(`Effective grace window: ${days} days`));
    if (days === 0) expect(dialog).toHaveAccessibleDescription(/immediately/);
    expect(rotate).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(rotate).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole('button', { name: name === 'personal' ? 'Rotate CI' : 'Rotate key CI' })
    );
    dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotate key' }));
    await screen.findByRole('button', { name: 'Reveal' });
    expect(rotate).toHaveBeenCalledWith('k1');
    expect(document.body.innerHTML).not.toContain(`${name}-rotated-once`);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(
      screen.getByRole('button', { name: name === 'personal' ? 'Revoke CI' : 'Revoke key CI' })
    );
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke key' })
    );
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('k1'));
  });

  it('prevents rotation when its effective policy cannot be read', async () => {
    policy.mockReturnValue({ data: undefined, isPending: false, error: new Error('offline') });
    show();
    expect(
      screen.getByRole('button', { name: name === 'personal' ? 'Rotate CI' : 'Rotate key CI' })
    ).toBeDisabled();
    await open();
    expect(screen.getByText(/rotation policy unavailable/i)).toBeVisible();
  });

  it('identifies the plan default when no account override exists', async () => {
    policy.mockReturnValue({
      data: { days: null, plan_default: 5 },
      isPending: false,
      error: null,
    });
    show();
    await userEvent.click(
      screen.getByRole('button', { name: name === 'personal' ? 'Rotate CI' : 'Rotate key CI' })
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(
      /Effective grace window: 5 days/
    );
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription(/plan default/i);
  });

  it('preserves one-time evidence when a second rotation is cancelled', async () => {
    show();
    const rotateLabel = name === 'personal' ? 'Rotate CI' : 'Rotate key CI';
    await userEvent.click(screen.getByRole('button', { name: rotateLabel }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Rotate key' })
    );
    await screen.findByRole('button', { name: 'Reveal' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: rotateLabel }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' })
    );
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument();
    expect(rotate).toHaveBeenCalledTimes(1);
  });

  it('starts a replacement key masked even if the previous one was revealed', async () => {
    rotate
      .mockResolvedValueOnce({ key_plaintext: 'first-secret' })
      .mockResolvedValueOnce({ key_plaintext: 'second-secret' });
    show();
    const rotateLabel = name === 'personal' ? 'Rotate CI' : 'Rotate key CI';
    await userEvent.click(screen.getByRole('button', { name: rotateLabel }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Rotate key' })
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Reveal' }));
    expect(screen.getByText('first-secret')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: rotateLabel }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Rotate key' })
    );
    await waitFor(() => expect(rotate).toHaveBeenCalledTimes(2));
    expect(document.body.innerHTML).not.toContain('second-secret');
    expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument();
  });
});
