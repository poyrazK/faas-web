import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WakeDrawer } from './wake-drawer';

vi.mock('./wake-waterfall', () => ({
  WakeWaterfall: ({ slug, wakeId }: { slug: string; wakeId: string }) => (
    <p>
      waterfall {slug} {wakeId}
    </p>
  ),
}));

describe('WakeDrawer', () => {
  it('shows the wake for the app over the page', () => {
    render(<WakeDrawer slug="api" wakeId="wk-1" onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Wake' });
    expect(dialog).toHaveAttribute('data-placement', 'right');
    expect(screen.getByText('waterfall api wk-1')).toBeInTheDocument();
    expect(screen.getByText('App api')).toBeInTheDocument();
  });

  it.each([
    [undefined, 'wk-1'],
    ['api', undefined],
    ['api', ''],
  ])('stays closed without both an app and a wake (%s, %s)', (slug, wakeId) => {
    // A pasted Analytics link can carry a wake but no app: the page must render normally.
    render(<WakeDrawer slug={slug} wakeId={wakeId} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<WakeDrawer slug="api" wakeId="wk-1" onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
