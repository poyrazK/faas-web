import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  retainSearchParams,
} from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import {
  environmentKind,
  environmentName,
  retainEnvironment,
  validateEnvironmentSearch,
} from './environment-scope';
import { validateProjectSearch } from './project-scope';

/** The /dashboard route's search contract, with a few children to move between. */
async function routerAt(entry: string) {
  const root = createRootRoute();
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    validateSearch: (search: Record<string, unknown>) => ({
      ...validateProjectSearch(search),
      ...validateEnvironmentSearch(search),
    }),
    search: { middlewares: [retainSearchParams(['project']), retainEnvironment] },
  });
  const index = createRoute({ getParentRoute: () => dashboard, path: '/' });
  const releases = createRoute({ getParentRoute: () => dashboard, path: 'releases' });
  const crons = createRoute({ getParentRoute: () => dashboard, path: 'crons' });
  const project = createRoute({ getParentRoute: () => dashboard, path: 'projects/$projectSlug' });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([index, releases, crons, project])]),
    history: createMemoryHistory({ initialEntries: [entry] }),
  });
  await router.load();
  return router;
}

const searchOf = (router: Awaited<ReturnType<typeof routerAt>>) =>
  router.state.location.search as Record<string, unknown>;

describe('validateEnvironmentSearch', () => {
  it('drops production and anything that is not an environment slug', () => {
    expect(validateEnvironmentSearch({ env: 'staging' })).toEqual({ env: 'staging' });
    expect(validateEnvironmentSearch({ env: 'production' })).toEqual({});
    expect(validateEnvironmentSearch({ env: 'Bad Slug!' })).toEqual({});
    expect(validateEnvironmentSearch({})).toEqual({});
  });
});

describe('retainEnvironment', () => {
  it('keeps ?env= while moving inside the project', async () => {
    const router = await routerAt('/dashboard/releases?project=shop&env=staging');
    await router.navigate({ to: '/dashboard/crons', search: (s: object) => s } as never);
    expect(searchOf(router)).toMatchObject({ project: 'shop', env: 'staging' });
  });

  it('keeps ?env= on links that do not mention it', async () => {
    const router = await routerAt('/dashboard/releases?project=shop&env=staging');
    await router.navigate({ to: '/dashboard/crons', search: { project: 'shop' } } as never);
    expect(searchOf(router)).toMatchObject({ project: 'shop', env: 'staging' });
  });

  it('keeps ?env= on links out of a project page path', async () => {
    const router = await routerAt('/dashboard/projects/shop?env=staging');
    await router.navigate({ to: '/dashboard/releases', search: { project: 'shop' } } as never);
    expect(searchOf(router)).toMatchObject({ project: 'shop', env: 'staging' });
  });

  it('drops ?env= when switching to another project', async () => {
    const router = await routerAt('/dashboard/releases?project=shop&env=staging');
    await router.navigate({ to: '/dashboard/releases', search: { project: 'tools' } } as never);
    expect(searchOf(router)).toEqual({ project: 'tools' });
  });

  it('drops ?env= when leaving the project', async () => {
    const router = await routerAt('/dashboard/releases?project=shop&env=staging');
    await router.navigate({ to: '/dashboard', search: { project: undefined } } as never);
    expect(searchOf(router)).not.toHaveProperty('env');
  });

  it('lets a link set or clear the environment explicitly', async () => {
    const router = await routerAt('/dashboard/releases?project=shop&env=staging');
    await router.navigate({
      to: '/dashboard/releases',
      search: (s: object) => ({ ...s, env: 'preview-42' }),
    } as never);
    expect(searchOf(router)).toMatchObject({ env: 'preview-42' });
    await router.navigate({
      to: '/dashboard/releases',
      search: (s: object) => ({ ...s, env: undefined }),
    } as never);
    expect(searchOf(router)).not.toHaveProperty('env');
    expect(searchOf(router)).toMatchObject({ project: 'shop' });
  });
});

describe('environment names', () => {
  it('names environments and tells production, stages and previews apart', () => {
    expect(environmentName('staging')).toBe('Staging');
    expect(environmentKind('production')).toBe('production');
    expect(environmentKind('staging', { branch: undefined } as never)).toBe('stage');
    expect(environmentKind('pr-42', { branch: { name: 'feat/x' } } as never)).toBe('preview');
  });
});
