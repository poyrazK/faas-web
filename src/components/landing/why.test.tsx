import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { REASONS, Why } from './why';

/**
 * A hover accordion is only fair if it also opens on focus and never hides
 * a reason from someone who cannot hover: every title is always present,
 * one body is always open, and moving focus opens the card under it.
 */
describe('Why', () => {
  it('shows all four reasons with the second open by default', () => {
    render(<Why />);
    for (const r of REASONS) {
      expect(screen.getByRole('heading', { name: r.title })).toBeInTheDocument();
    }
    const cards = screen.getAllByRole('button');
    expect(cards).toHaveLength(4);
    expect(cards[1]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(REASONS[1].body)).toBeInTheDocument();
  });

  it('opens the card the pointer or focus lands on, and keeps it open after leaving', async () => {
    const user = userEvent.setup();
    render(<Why />);
    const cards = screen.getAllByRole('button');
    await user.hover(cards[3]);
    await waitFor(() => expect(cards[3]).toHaveAttribute('aria-expanded', 'true'));
    expect(cards[1]).toHaveAttribute('aria-expanded', 'false');
    await user.unhover(cards[3]);
    expect(cards[3]).toHaveAttribute('aria-expanded', 'true');
    cards[0].focus();
    await waitFor(() => expect(cards[0]).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByText(REASONS[0].body)).toBeInTheDocument();
  });
});
