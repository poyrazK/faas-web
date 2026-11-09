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
  it('names the app as its link and shows the 24 h figures', async () => {
    const list = await renderTiles(<AppTile slug="api" app={app({})} />);
    expect(within(list).getByRole('link', { name: 'api' })).toHaveAttribute(
      'href',
      '/dashboard/apps/api'
    );
    expect(within(list).getByText('6.72K')).toBeInTheDocument();
    expect(within(list).getByText('0.42%')).toBeInTheDocument();
    expect(within(list).getByText('512')).toBeInTheDocument();
    expect(memoryOf(2048)).toEqual({ value: '2', unit: 'GB' });
  });

  it('marks a high error share and draws a never-deployed app hollow', async () => {
    const list = await renderTiles(
      <>
        <AppTile slug="hot" app={app({ id: 'hot', name: 'hot', errorRatePct: 25.65 })} />
        <AppTile
          slug="new"
          app={app({ id: 'new', name: 'new', state: 'undeployed', lastDeployedAt: 0 })}
        />
      </>
    );
    expect(within(list).getByText('25.6%')).toHaveAttribute('data-hot');
    const fresh = within(list).getByRole('link', { name: 'new' }).closest('li')!;
    expect(fresh).toHaveAttribute('data-state', 'undeployed');
    expect(within(fresh).getByText('Not deployed yet')).toBeInTheDocument();
    expect(within(fresh).getByText('No deployments')).toBeInTheDocument();
  });

  it('never shows zeros when request figures are unavailable', async () => {
    const list = await renderTiles(
      <AppTile
        slug="api"
        app={app({ metricsUnavailable: true, invocations24h: 0, errorRatePct: 0 })}
      />
    );
    expect(within(list).getByText('512 MB · request figures unavailable')).toBeInTheDocument();
    expect(within(list).queryByText('0')).not.toBeInTheDocument();
    expect(within(list).queryByText('0.00%')).not.toBeInTheDocument();
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
