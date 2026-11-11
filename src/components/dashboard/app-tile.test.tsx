import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Workflow } from '@/lib/mock-data';
import { AppTile, AppTiles, byState, memoryOf } from './app-tile';

const app = (over: Partial<Workflow>): Workflow => ({
  id: 'api',
  name: 'api',
  runtime: 'node22',
  memoryMb: 512,
  state: 'running',
  url: 'https://api.example.com',
  invocations24h: 6720,
  avgDurationMs: 20,
  coldStartP50Ms: 80,
  errorRatePct: 0.42,
  lastDeployedAt: Date.now() - 3_600_000,
  version: 'f35835e',
  ...over,
});

async function renderTiles(tiles: React.ReactNode) {
  const root = createRootRoute({ component: () => <AppTiles label="Apps">{tiles}</AppTiles> });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
  return screen.findByRole('list', { name: 'Apps' });
}

describe('AppTile', () => {
  it('names the app as its link and shows what it runs on, with no traffic figures', async () => {
    const list = await renderTiles(<AppTile slug="api" app={app({ errorRatePct: 25.65 })} />);
    expect(within(list).getByRole('link', { name: 'api' })).toHaveAttribute(
      'href',
      '/dashboard/apps/api'
    );
    expect(within(list).getByText('Node 22 · 512 MB')).toBeInTheDocument();
    expect(within(list).queryByText(/requests|errors|failed/)).not.toBeInTheDocument();
    expect(within(list).queryByText('6.72K')).not.toBeInTheDocument();
    expect(memoryOf(2048)).toEqual({ value: '2', unit: 'GB' });
  });

  it('draws a never-deployed app hollow', async () => {
    const list = await renderTiles(
      <AppTile
        slug="new"
        app={app({ id: 'new', name: 'new', state: 'undeployed', lastDeployedAt: 0 })}
      />
    );
    const fresh = within(list).getByRole('link', { name: 'new' }).closest('li')!;
    expect(fresh).toHaveAttribute('data-state', 'undeployed');
    expect(within(fresh).getByText('No deployments')).toBeInTheDocument();
  });

  it('says when the latest deploy failed, next to the running state', async () => {
    const list = await renderTiles(
      <AppTile
        slug="api"
        app={app({})}
        deploy={{ tone: 'critical', text: 'deploy failed', at: Date.now() - 3 * 3_600_000 }}
      />
    );
    expect(within(list).getByText('Running')).toBeInTheDocument();
    expect(within(list).getByText(/deploy failed 3h ago/)).toHaveClass('text-status-critical');
  });
});

it('orders failing and live apps before idle and never-deployed ones', () => {
  const names = [
    app({ name: 'zeta', state: 'undeployed' }),
    app({ name: 'beta', state: 'idle' }),
    app({ name: 'alpha', state: 'running' }),
    app({ name: 'omega', state: 'error' }),
  ]
    .sort(byState)
    .map((a) => a.name);
  expect(names).toEqual(['omega', 'alpha', 'beta', 'zeta']);
});
