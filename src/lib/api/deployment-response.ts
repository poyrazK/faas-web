import { api, unwrap } from './client';
import type { App, Deployment } from './queries';
import type { components } from './schema';
import { activeOrgHeader } from '../workspace';
import { resourceId } from '../resource-id';

export type ResponseCheck = components['schemas']['DeploymentResponseCheckResult'];
export type ResponseDeployment = Pick<Deployment, 'id' | 'app_id' | 'scope' | 'status'>;

function responseID(value: string): boolean {
  return Boolean(resourceId(value)) && value === value.toLowerCase() && /[1-9a-f]/.test(value);
}

export function validResponsePath(path: string): boolean {
  return (
    path.length <= 2048 &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !/[\\\s#]/.test(path) &&
    !Array.from(path).some(
      (char) => char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)
    )
  );
}

export function appAccess(app?: App): 'public' | 'private' | 'internal' | 'unknown' {
  if (!app) return 'unknown';
  if (app.visibility === 'internal' || app.public_auth?.mode === 'internal_only') return 'internal';
  return app.require_authn ||
    app.consumer_auth_mode === 'required' ||
    (app.public_auth?.mode && app.public_auth.mode !== 'open')
    ? 'private'
    : 'public';
}

export function canVerifyHTTP(app?: App): boolean {
  const mode = app?.manifest?.execution_mode;
  return (
    mode !== 'worker' &&
    mode !== 'job' &&
    app?.workload_class !== 'worker' &&
    app?.workload_class !== 'job'
  );
}

/** Explicit checks keep paths and response bodies out of query/mutation caches. */
export async function checkDeploymentResponse(
  slug: string,
  deployment: ResponseDeployment,
  path: string,
  signal: AbortSignal
): Promise<ResponseCheck> {
  if (
    !validResponsePath(path) ||
    !responseID(deployment.id) ||
    !responseID(deployment.app_id) ||
    deployment.status !== 'live'
  )
    throw new Error('A live deployment and an app-relative GET path are required.');
  const scope = deployment.scope || 'default';
  const [capabilities, app] = await Promise.all([
    unwrap(api.GET('/v1/deployments/response-check/capabilities', { signal, cache: 'no-store' })),
    unwrap(
      api.GET('/v1/apps/{slug}', {
        params: {
          path: { slug },
          ...(scope !== 'default' ? { query: { environment: scope } } : {}),
        },
        signal,
        cache: 'no-store',
      })
    ),
  ]);
  if (
    capabilities.protocol_version !== 1 ||
    !capabilities.available ||
    capabilities.unavailable_reason
  )
    throw new Error(
      'Deployment verification is unavailable on this installation. Your deployment is unchanged. Retry when the service is available.'
    );
  if (app.id !== deployment.app_id || app.slug !== slug)
    throw new Error('The app identity changed. Refresh the deployment before verifying it.');
  const request: components['schemas']['DeploymentResponseCheckRequest'] = {
    app_id: app.id,
    scope,
    path,
  };
  if (scope !== 'default') {
    const org = activeOrgHeader();
    const projects = await unwrap(
      org
        ? api.GET('/v1/orgs/{organization}/projects', {
            params: { path: { organization: org } },
            signal,
            cache: 'no-store',
          })
        : api.GET('/v1/projects', { signal, cache: 'no-store' })
    );
    const project = projects.find((p) => p.id === app.project_id);
    if (!project)
      throw new Error('Select this app’s project workspace before checking its environment.');
    const environment = await unwrap(
      api.GET('/v1/projects/{slug}/environments/{environment}', {
        params: { path: { slug: project.slug, environment: scope } },
        signal,
        cache: 'no-store',
      })
    );
    if (
      !responseID(environment.id) ||
      environment.project_id !== project.id ||
      environment.slug !== scope
    )
      throw new Error('The environment identity changed. Refresh before verifying it.');
    request.project_id = project.id;
    request.environment_id = environment.id;
  }
  const result = await unwrap(
    api.POST('/v1/apps/{slug}/deployments/{deployment}/response-check', {
      params: { path: { slug, deployment: deployment.id } },
      body: request,
      signal,
      cache: 'no-store',
    })
  );
  if (
    result.app_id !== request.app_id ||
    result.deployment_id !== deployment.id ||
    result.scope !== scope ||
    (result.project_id || '') !== (request.project_id || '') ||
    (result.environment_id || '') !== (request.environment_id || '') ||
    !responseID(result.instance_id) ||
    !Number.isInteger(result.http_status) ||
    result.http_status < 200 ||
    result.http_status > 599 ||
    new TextEncoder().encode(result.body).length > 4096
  )
    throw new Error(
      'The response did not identify this app, deployment, environment, and running instance. Refresh and retry verification.'
    );
  return result;
}
