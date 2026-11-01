import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { routeTree } from '@/routeTree.gen';

/**
 * Public pages render for visitors who have no account, so they must not ask
 * the API for an account's apps or deployments. The console's data store was
 * once mounted at the root, which sent /v1/apps, /v1/deployments and
 * /v1/deployments/latest-by-app from the landing page for every visitor.
 */
// A request that never settles: what is asked matters here, not the answer.
// The narrowed view keeps TypeScript out of the client's path-typed overloads.
const client = api as unknown as { GET: (path: string) => Promise<unknown> };
const get = vi.spyOn(client, 'GET').mockImplementation(() => new Promise(() => undefined));

beforeEach(() => {
  get.mockClear();
});

describe('public pages', () => {
  it.each(['/', '/docs'])('%s asks the API for nothing', async (path) => {
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    await router.load();
    render(<RouterProvider router={router} />);
    await screen.findAllByRole('link');
    // Let any effect-triggered query start before checking.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(get.mock.calls.map(([path]) => path)).toEqual([]);
  });
});
