import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route as DeployRoute } from './deploy';

vi.mock('@/components/landing/nav', () => ({ Nav: () => <nav>Nav</nav> }));
vi.mock('@/components/landing/footer', () => ({ Footer: () => <footer>Footer</footer> }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

async function renderDeploy(url: string) {
  const root = createRootRoute({ component: Outlet });
  const deploy = createRoute({
    getParentRoute: () => root,
    path: 'deploy',
    validateSearch: DeployRoute.options.validateSearch,
    beforeLoad: DeployRoute.options.beforeLoad,
    component: DeployRoute.options.component,
  });
  const signup = createRoute({
    getParentRoute: () => root,
    path: 'signup',
    component: () => <p>Signup</p>,
  });
  const login = createRoute({
    getParentRoute: () => root,
    path: 'login',
    component: () => <p>Login</p>,
  });
  const willItRun = createRoute({
    getParentRoute: () => root,
    path: 'will-it-run',
    component: () => <p>WillItRun</p>,
  });
  const templates = createRoute({
    getParentRoute: () => root,
    path: 'templates',
    component: () => <p>Templates</p>,
  });
  const docsSlug = createRoute({
    getParentRoute: () => root,
    path: 'docs/$slug',
    component: () => <p>Doc</p>,
  });
  const newApp = createRoute({
    getParentRoute: () => root,
    path: 'dashboard/apps/new',
    component: () => <p>NewApp</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([deploy, signup, login, willItRun, templates, docsSlug, newApp]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}

describe('/deploy', () => {
  it('renders starter metadata, auth handoff links, and badge snippet when signed out', async () => {
    await renderDeploy('/deploy?repo=https://github.com/gregale-dev/nextjs-postgres-starter');
    expect(screen.getByText('Next.js 16 + Postgres Starter')).toBeTruthy();
    const signupLink = screen.getByRole('link', { name: /Deploy on Gregale/i });
    const loginLink = screen.getByRole('link', { name: /Sign in to deploy/i });
    expect(signupLink.getAttribute('href')).toContain('/signup?next=');
    expect(signupLink.getAttribute('href')).toContain(
      encodeURIComponent(
        '/dashboard/apps/new?source=git&repo=gregale-dev%2Fnextjs-postgres-starter'
      )
    );
    expect(loginLink.getAttribute('href')).toContain('/login?next=');
    expect(
      screen.getByText(
        '[![Deploy on Gregale](https://gregale.dev/deploy-badge.svg)](https://gregale.dev/deploy?repo=https://github.com/gregale-dev/nextjs-postgres-starter)'
      )
    ).toBeTruthy();
  });

  it('redirects signed-in sessions straight to /dashboard/apps/new with repo prefilled', async () => {
    window.localStorage.setItem(
      'gregale.session',
      JSON.stringify({ id: 'usr_1', email: 'dev@example.test' })
    );
    const router = await renderDeploy(
      '/deploy?repo=https://github.com/gregale-dev/mcp-server-python&ref=v1.0.0'
    );
    expect(router.state.location.pathname).toBe('/dashboard/apps/new');
    expect(router.state.location.search).toMatchObject({
      source: 'git',
      repo: 'gregale-dev/mcp-server-python',
      ref: 'v1.0.0',
    });
  });

  it('shows repository input form when repo is missing or invalid', async () => {
    await renderDeploy('/deploy?repo=https://gitlab.com/acme/not-github');
    expect(screen.getByRole('alert').textContent).toContain('not a valid GitHub repository URL');
    expect(screen.getByLabelText('GitHub repository URL or owner/repo')).toBeTruthy();
  });
});
