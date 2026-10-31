import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './command-palette';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ pathname: '/dashboard', search: {}, hash: '' }),
}));

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'account1' } }) }));
const hiddenCapabilities = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('./nav-access', () => ({
  useCapabilityOff: () => (id: string) => hiddenCapabilities.ids.includes(id),
}));
vi.mock('@/lib/api/palette', () => ({
  usePaletteResources: () => ({
    deployments: [],
    domains: [],
    keys: [],
    invocations: [],
    enabled: false,
  }),
}));

const store = vi.hoisted(() => ({ workflows: [] as unknown[] }));
vi.mock('@/lib/store', () => ({
  useData: () => ({ workflows: store.workflows }),
}));

function renderPalette(onOpenChange = vi.fn()) {
  render(<CommandPalette open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

describe('CommandPalette', () => {
  it('counts HTTP requests in app hints when metrics are known', async () => {
    store.workflows = [
      {
        id: 'alpha',
        name: 'alpha',
        runtime: 'node24',
        invocations24h: 3,
        metricsUnavailable: false,
      },
    ];
    try {
      renderPalette();
      await userEvent.type(
        await screen.findByRole('combobox', { name: /search commands/i }),
        'alpha'
      );
      expect(await screen.findByText('3 requests · node24')).toBeInTheDocument();
      expect(screen.queryByText(/calls/)).not.toBeInTheDocument();
    } finally {
      store.workflows = [];
    }
  });

  it('leaves request counts out of app hints when request metrics are unknown', async () => {
    store.workflows = [
      {
        id: 'alpha',
        name: 'alpha',
        runtime: 'node24',
        invocations24h: 0,
        metricsUnavailable: true,
      },
    ];
    try {
      renderPalette();
      await userEvent.type(
        await screen.findByRole('combobox', { name: /search commands/i }),
        'alpha'
      );
      expect(await screen.findByText('node24')).toBeInTheDocument();
      expect(screen.queryByText(/0 requests/)).not.toBeInTheDocument();
    } finally {
      store.workflows = [];
    }
  });

  it('closes on Escape even before the user clicks into the dialog', async () => {
    const onOpenChange = renderPalette();
    const user = userEvent.setup();
    const input = await screen.findByRole('combobox', { name: /search commands/i });
    await waitFor(() => expect(input).toHaveFocus());
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    try {
      await user.keyboard('{Escape}');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      opener.remove();
    }
  });

  it('does not list a page apid hides from the account', async () => {
    hiddenCapabilities.ids = ['object-storage'];
    try {
      renderPalette();
      const input = await screen.findByRole('combobox', { name: /search commands/i });
      await userEvent.type(input, 'stor');
      expect(screen.queryByRole('option', { name: /^Storage/ })).toBeNull();
      hiddenCapabilities.ids = [];
    } finally {
      hiddenCapabilities.ids = [];
    }
  });

  it('moves focus into the search input after opening', async () => {
    renderPalette();
    const input = await screen.findByRole('combobox', { name: /search commands/i });

    await waitFor(() => expect(input).toHaveFocus());
  });

  it('closes once when Escape starts inside the palette', async () => {
    const onOpenChange = renderPalette();
    const input = await screen.findByRole('combobox', { name: /search commands/i });
    const user = userEvent.setup();
    await waitFor(() => expect(input).toHaveFocus());

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does not claim Escape when another dialog is stacked above it', async () => {
    const onOpenChange = renderPalette();
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    document.body.append(modal);
    const user = userEvent.setup();

    try {
      await user.keyboard('{Escape}');
      expect(onOpenChange).not.toHaveBeenCalled();
    } finally {
      modal.remove();
    }
  });

  it('does not trap Tab when another dialog is stacked above it', async () => {
    renderPalette();
    await screen.findByRole('combobox', { name: /search commands/i });

    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const button = document.createElement('button');
    modal.append(button);
    document.body.append(modal);
    button.focus();

    try {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true,
      });
      document.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(button);
    } finally {
      modal.remove();
    }
  });
});
