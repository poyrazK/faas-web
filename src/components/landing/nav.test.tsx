import { render, screen } from '@testing-library/react';
import { GlimmProvider } from 'glimm/react';
import { describe, expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { Nav } from './nav';

function renderNav() {
  return render(
    withRouter(
      <GlimmProvider palette="lagoon">
        <Nav />
      </GlimmProvider>
    )
  );
}

/**
 * Every destination the nav offers must be there, reachable, and named.
 */
describe('Nav', () => {
  it('keeps the three primary links and the two account actions', async () => {
    renderNav();
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    expect(nav).toHaveTextContent('Platform');
    expect(nav).toHaveTextContent('Pricing');
    expect(nav).toHaveTextContent('Docs');
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: /get started/i })).toHaveAttribute('href', '/signup');
  });

  it('keeps the home link on the mark', async () => {
    renderNav();
    const home = await screen.findByRole('link', { name: 'Gregale' });
    expect(home).toHaveAttribute('href', '/');
  });

  it('exposes the mobile menu toggle with its state', async () => {
    renderNav();
    const toggle = await screen.findByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
