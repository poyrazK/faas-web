import type { ReactNode } from 'react';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderWithProviders, routeApi } from '@/test/monetization';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));

const { RoutesBody } = await import('./routes');

let spies: ReturnType<typeof routeApi>;
beforeEach(() => {
  spies = routeApi({
    'GET /v1/apps/{slug}/routes': () => ({ app_id: 'a1', routes: [], source: 'prometheus' }),
    'GET /v1/apps/{slug}': () => ({ id: 'a1', slug: 'api', route_metrics_enabled: true }),
    'GET /v1/domains': () => [],
  });
});
afterEach(() => vi.restoreAllMocks());

it('says it shows Staging’s route traffic, and reads it with environment=staging', async () => {
  renderWithProviders(<RoutesBody slug="api" environment="staging" environmentName="Staging" />);
  expect(await screen.findByRole('note')).toHaveTextContent('Route traffic in Staging.');
  expect(spies.GET).toHaveBeenCalledWith(
    '/v1/apps/{slug}/routes',
    expect.objectContaining({
      params: { path: { slug: 'api' }, query: { environment: 'staging' } },
    })
  );
});

it('production has no note and no environment selector', async () => {
  renderWithProviders(<RoutesBody slug="api" />);
  await screen.findByRole('region', { name: 'Routes at a glance' });
  expect(screen.queryByRole('note')).toBeNull();
  expect(spies.GET).toHaveBeenCalledWith(
    '/v1/apps/{slug}/routes',
    expect.objectContaining({ params: { path: { slug: 'api' } } })
  );
});
