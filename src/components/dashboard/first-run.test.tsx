import { render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { FirstRun } from './first-run';

describe('first-run entry points', () => {
  it('links directly into Git and template setup with CLI instructions secondary', async () => {
    const root = createRootRoute({ component: FirstRun });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    expect(screen.getByRole('link', { name: 'Deploy from GitHub' })).toHaveAttribute(
      'href',
      '/dashboard/workflows/new?source=git'
    );
    expect(screen.getByRole('link', { name: 'Explore templates' })).toHaveAttribute(
      'href',
      '/dashboard/workflows/new?source=template'
    );
    const cli = screen.getByText('Prefer the CLI?').closest('details');
    expect(cli).not.toHaveAttribute('open');
  });
});
