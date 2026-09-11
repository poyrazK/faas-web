import { createMemoryHistory, createRouter } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { routeTree } from '@/routeTree.gen';

describe('legacy dashboard bookmarks', () => {
  it.each([
    '/dashboard/workflows?q=api&state=running&runtime=node24',
    '/dashboard/workflows/api?tab=Deployments&deployment=dep-1#lifecycle',
    '/dashboard/workflows/new?template=hello-world',
    '/dashboard/jobs',
    '/dashboard/workers',
    '/dashboard/deployments',
    '/dashboard/domains',
    '/dashboard/edge-rules',
    '/dashboard/storage',
    '/dashboard/postgres',
    '/dashboard/debug',
    '/dashboard/traces',
    '/dashboard/audit',
    '/dashboard/usage',
    '/dashboard/invoices',
    '/dashboard/plans',
    '/dashboard/settings',
    '/dashboard/logs?app=api&level=error&q=timeout&mode=archive#logs',
    '/dashboard/metrics?range=1h',
    '/dashboard/apis',
    '/dashboard/secrets',
    '/dashboard/env',
    '/dashboard/queues',
    '/dashboard/databases',
    '/dashboard/alerts',
    '/dashboard/webhooks',
    '/dashboard/mirrors',
    '/dashboard/tenant-surfaces',
    '/dashboard/openapi',
  ])('continues resolving %s with its search and hash intact', async (entry) => {
    window.localStorage.setItem(
      'gregale.session',
      JSON.stringify({ email: 'operator@example.com' })
    );
    window.localStorage.setItem('gregale.onboarded', 'true');
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [entry] }),
    });
    await router.load();
    expect(router.state.location.href).toBe(entry);
    const match = router.state.matches.at(-1)!;
    expect(match.status).toBe('success');
    expect(match.pathname.replace(/\/$/, '')).toBe(entry.split(/[?#]/)[0]);
  });

  it.each([
    ['/dashboard/templates', '/dashboard/workflows/new?source=template'],
    ['/dashboard/import', '/dashboard/workflows/new?source=import'],
    ['/dashboard/crons', '/dashboard/jobs?section=scheduled'],
    ['/dashboard/triggers', '/dashboard/jobs?section=triggers'],
    ['/dashboard/builds', '/dashboard/deployments?view=builds'],
    ['/dashboard/team', '/dashboard/settings?section=members'],
    ['/dashboard/keys', '/dashboard/settings?section=api-keys'],
    ['/dashboard/security', '/dashboard/settings?section=security'],
    [
      '/dashboard/account?github=connected&default_branch=develop',
      '/dashboard/settings?github=connected&default_branch=develop&section=integrations',
    ],
  ])('resolves %s through its compatibility redirect', async (entry, destination) => {
    window.localStorage.setItem(
      'gregale.session',
      JSON.stringify({ email: 'operator@example.com' })
    );
    window.localStorage.setItem('gregale.onboarded', 'true');
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [entry] }),
    });
    await router.load();
    expect(router.state.location.href).toBe(destination);
    expect(router.state.matches.at(-1)?.status).toBe('success');
  });

  it('allows the fixed GitHub callback to reach Integrations before consuming the onboarding return marker', async () => {
    window.localStorage.setItem(
      'gregale.session',
      JSON.stringify({ email: 'operator@example.com' })
    );
    window.sessionStorage.setItem('gregale.onboarding-github-return', 'true');
    const router = createRouter({
      routeTree,
      history: createMemoryHistory({
        initialEntries: ['/dashboard/account?github=connected&default_branch=main'],
      }),
    });
    await router.load();
    expect(router.state.location.pathname).toBe('/dashboard/settings');
    expect(router.state.location.search).toMatchObject({
      section: 'integrations',
      github: 'connected',
      default_branch: 'main',
    });
  });
});
