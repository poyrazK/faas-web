import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { routeTree } from './routeTree.gen';

async function renderPublicRoute(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

describe('public operator contact information', () => {
  it('makes the operator page discoverable from the landing footer', async () => {
    await renderPublicRoute('/');
    const footer = await screen.findByRole('contentinfo');

    expect(within(footer).getByRole('link', { name: 'Operators & Contact' })).toHaveAttribute(
      'href',
      '/operators-contact'
    );
  });

  it('renders operator identities without requiring an account', async () => {
    const router = await renderPublicRoute('/operators-contact');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Operators & Contact' })
    ).toBeVisible();
    const main = screen.getByRole('main');
    expect(within(main).getByText('Hüseyin Poyraz Küçükarslan')).toBeVisible();
    expect(within(main).getByText('Bahadır Koşapınar')).toBeVisible();
    expect(main).toHaveTextContent('Türkiye');
    expect(router.state.matches.flatMap((match) => match.meta ?? [])).toContainEqual({
      title: 'Operators & Contact · Gregale',
    });
  });

  it('provides an actionable support, privacy, and legal email contact', async () => {
    await renderPublicRoute('/operators-contact');
    const main = await screen.findByRole('main');

    expect(within(main).getByRole('link', { name: 'support@gregale.dev' })).toHaveAttribute(
      'href',
      'mailto:support@gregale.dev'
    );
  });
});
