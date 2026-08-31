import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { Process, STEPS } from './process';

/**
 * The stepper replaces the platform grid, so it must still carry every docs
 * destination the grid offered, and it must be operable without the mouse
 * and without waiting for the autoplay.
 */
describe('Process', () => {
  it('lists four steps as tabs and shows the first panel', async () => {
    render(withRouter(<Process />));
    const tabs = await screen.findAllByRole('tab');
    expect(tabs).toHaveLength(4);
    expect(tabs.map((t) => t.textContent)).toEqual(STEPS.map((s, i) => `0${i + 1}${s.title}`));
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent(STEPS[0].body);
  });

  it('moves with Next, Prev and the tabs themselves', async () => {
    const user = userEvent.setup();
    render(withRouter(<Process />));
    const shows = (i: number) =>
      waitFor(() => expect(screen.getByRole('tabpanel')).toHaveTextContent(STEPS[i].body));
    await user.click(await screen.findByRole('button', { name: /next/i }));
    await shows(1);
    await user.click(screen.getByRole('button', { name: /prev/i }));
    await shows(0);
    await user.click(screen.getByRole('tab', { name: /observe/i }));
    await shows(3);
  });

  it('keeps every docs link the platform grid had, across the steps', async () => {
    const user = userEvent.setup();
    render(withRouter(<Process />));
    await screen.findAllByRole('tab');
    const hrefs = new Set<string>();
    for (let i = 0; i < STEPS.length; i++) {
      if (i > 0) await user.click(screen.getByRole('button', { name: /next/i }));
      await waitFor(() => expect(screen.getByRole('tabpanel')).toHaveTextContent(STEPS[i].body));
      for (const a of screen.getAllByRole('link')) {
        const href = a.getAttribute('href');
        if (href?.startsWith('/docs/')) hrefs.add(href);
      }
    }
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
