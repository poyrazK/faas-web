import { describe, expect, it, vi } from 'vitest';

// Route modules pull in their pages; these tests only read each route's
// component, so the heavy page modules load but never render.
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { id: 'a' } }) }));

const ROUTES = [
  ['logs', () => import('./dashboard.logs')],
  ['metrics', () => import('./dashboard.metrics')],
  ['alerts', () => import('./dashboard.alerts')],
  ['webhooks', () => import('./dashboard.webhooks')],
  ['mirrors', () => import('./dashboard.mirrors')],
  ['openapi', () => import('./dashboard.openapi')],
  ['queues', () => import('./dashboard.queues')],
  ['releases', () => import('./dashboard.releases')],
  ['instances', () => import('./dashboard.instances')],
] as const;

describe('pages with no environment carry the production banner', () => {
  it.each(ROUTES)('/dashboard/%s', async (_name, load) => {
    const { Route } = await load();
    const component = Route.options.component as { name?: string } | undefined;
    expect(component?.name).toBe('WithProductionBanner');
  });
});
