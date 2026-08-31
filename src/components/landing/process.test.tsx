import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { Process, STEPS } from './process';

/**
 * The platform row is the same accordion as "Why": four cards, one open,
 * hover or focus opens another. It replaces the grid, so every docs
 * destination the grid offered must still be reachable from the open cards.
 */
describe('Process', () => {
  it('shows the four stops as cards with the first open by default', async () => {
    render(withRouter(<Process />));
    const cards = await screen.findAllByRole('button', { expanded: undefined });
    expect(cards).toHaveLength(4);
    for (const s of STEPS) {
      expect(screen.getByRole('heading', { name: s.title })).toBeInTheDocument();
    }
    expect(cards[0]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(STEPS[0].body)).toBeInTheDocument();
  });

  it('opens the card under the pointer and keeps it open after leaving', async () => {
    const user = userEvent.setup();
    render(withRouter(<Process />));
    const cards = await screen.findAllByRole('button');
    await user.hover(cards[2]);
    await waitFor(() => expect(cards[2]).toHaveAttribute('aria-expanded', 'true'));
    await user.unhover(cards[2]);
    expect(cards[2]).toHaveAttribute('aria-expanded', 'true');
    expect(cards[0]).toHaveAttribute('aria-expanded', 'false');
  });

  it('keeps every docs link the platform grid had', async () => {
    render(withRouter(<Process />));
    await screen.findAllByRole('button');
    // jsdom reports no `min-width` match, so every card renders open here.
    const hrefs = new Set(screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? ''));
    for (const slug of [
      'deploy-from-source',
      'preview-environments',
      'egress-denylist',
      'scale-to-zero',
      'runtime-node',
      'storage',
      'tracing',
    ]) {
      expect(hrefs).toContain(`/docs/${slug}`);
    }
  });
});
