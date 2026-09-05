import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './command-palette';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/lib/store', () => ({
  useData: () => ({ workflows: [] }),
}));

function renderPalette(onOpenChange = vi.fn()) {
  render(<CommandPalette open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

describe('CommandPalette', () => {
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
