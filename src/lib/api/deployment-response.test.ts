import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { checkDeploymentResponse, validResponsePath } from './deployment-response';
import { bindWorkspaceAccount, setActiveOrg } from '../workspace';
const app = { id: 'a'.repeat(32), slug: 'hello', project_id: 'd'.repeat(32) };
const deployment = { id: 'b'.repeat(32), app_id: app.id, status: 'live' };
const result = {
  app_id: app.id,
  deployment_id: deployment.id,
  scope: 'default',
  instance_id: 'c'.repeat(32),
  http_status: 200,
  body: 'ready',
  body_truncated: false,
};
const environment = { id: 'e'.repeat(32), project_id: app.project_id, slug: 'staging' };
const call = (target = deployment) =>
  checkDeploymentResponse(app.slug, target, '/ready', new AbortController().signal);
beforeEach(() => {
  spyApi('GET').mockImplementation(async (path) => ({
    data:
      path === '/v1/deployments/response-check/capabilities'
        ? { protocol_version: 1, available: true }
        : path === '/v1/projects' || path === '/v1/orgs/{organization}/projects'
          ? [{ id: app.project_id, slug: 'shop' }]
          : path === '/v1/projects/{slug}/environments/{environment}'
            ? environment
            : app,
    response: new Response(),
  }));
  spyApi('POST').mockResolvedValue({ data: result, response: new Response() });
});
afterEach(() => {
  vi.restoreAllMocks();
  bindWorkspaceAccount('');
  localStorage.clear();
});
it('uses one exact owner-authorized GET on Free without invoking or caching', async () => {
  const post = spyApi('POST');
  expect(await call()).toEqual(result);
  expect(post).toHaveBeenCalledOnce();
  expect(post).toHaveBeenCalledWith(
    '/v1/apps/{slug}/deployments/{deployment}/response-check',
    expect.objectContaining({
      params: { path: { slug: app.slug, deployment: deployment.id } },
      body: { app_id: app.id, scope: 'default', path: '/ready' },
      cache: 'no-store',
    })
  );
});
it.each([
  { deployment_id: 'f'.repeat(32) },
  { app_id: 'f'.repeat(32) },
  { scope: 'staging' },
  { instance_id: '' },
  { instance_id: '0'.repeat(32) },
  { http_status: 200.5 },
  { project_id: 'f'.repeat(32) },
  { http_status: 0 },
  { body: 'x'.repeat(4097) },
])('rejects inconsistent evidence %j', async (changes) => {
  spyApi('POST').mockResolvedValue({ data: { ...result, ...changes }, response: new Response() });
  await expect(call()).rejects.toThrow('did not identify');
});
it('returns the inner application failure status for the UI to explain', async () => {
  spyApi('POST').mockResolvedValue({
    data: { ...result, http_status: 401 },
    response: new Response(),
  });
  expect((await call()).http_status).toBe(401);
});
it('does not fall back when verification is unsupported', async () => {
  spyApi('GET').mockResolvedValue({
    data: { protocol_version: 0, available: false },
    response: new Response(),
  });
  await expect(call()).rejects.toThrow('unavailable');
  expect(spyApi('POST')).not.toHaveBeenCalled();
});
it('resolves and pins the selected workspace’s named environment', async () => {
  bindWorkspaceAccount('actor');
  setActiveOrg('acme');
  spyApi('POST').mockResolvedValue({
    data: {
      ...result,
      scope: 'staging',
      project_id: app.project_id,
      environment_id: environment.id,
    },
    response: new Response(),
  });
  await call({ ...deployment, scope: 'staging' } as typeof deployment);
  expect(spyApi('GET')).toHaveBeenCalledWith(
    '/v1/orgs/{organization}/projects',
    expect.objectContaining({ params: { path: { organization: 'acme' } } })
  );
  expect(spyApi('POST')).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      body: {
        app_id: app.id,
        scope: 'staging',
        path: '/ready',
        project_id: app.project_id,
        environment_id: environment.id,
      },
    })
  );
});
it.each(['//other.test', 'https://other.test', '/bad#fragment', '/bad space'])(
  'rejects unsafe paths %s',
  (path) => {
    expect(validResponsePath(path)).toBe(false);
  }
);
