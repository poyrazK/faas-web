import { api, unwrap } from './client';
import type { components } from './schema';

export type APISandboxSuite = components['schemas']['APISandboxSuite'];
export type APISandboxSuiteSaveRequest = components['schemas']['APISandboxSuiteSaveRequest'];
export type APISandboxSuiteRunRequest = components['schemas']['APISandboxSuiteRunRequest'];
export type APISandboxSuiteRunReport = components['schemas']['APISandboxSuiteRunReport'];
export type APISandboxSuiteRunsResponse = components['schemas']['APISandboxSuiteRunsResponse'];

export function getSandboxSuite(slug: string, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/api-sandbox-suite', {
      params: { path: { slug } },
      signal,
    })
  );
}

export function saveSandboxSuite(slug: string, body: APISandboxSuiteSaveRequest) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/api-sandbox-suite', {
      params: { path: { slug } },
      body,
    })
  );
}

export function listSandboxSuiteRuns(id: string, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/deployments/{id}/approvals/sandbox-suite-runs', {
      params: { path: { id } },
      signal,
    })
  );
}

export function getSandboxSuiteRun(id: string, run: string, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/deployments/{id}/approvals/sandbox-suite-runs/{run}', {
      params: { path: { id, run } },
      signal,
    })
  );
}

export function startSandboxSuiteRun(id: string, run: string, body: APISandboxSuiteRunRequest) {
  return unwrap(
    api.PUT('/v1/deployments/{id}/approvals/sandbox-suite-runs/{run}', {
      params: { path: { id, run } },
      body,
    })
  );
}
