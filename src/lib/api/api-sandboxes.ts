import createClient from 'openapi-fetch';
import { api, unwrap } from './client';
import type { components, paths } from './schema';

export type APISandbox = components['schemas']['APISandboxResponse'];
export type APISandboxScenario = components['schemas']['APISandboxScenario'];
export type APISandboxScenarioInput = components['schemas']['APISandboxScenarioInput'];
export type APISandboxScenarioDraft = components['schemas']['APISandboxScenarioDraft'];
export type APISandboxScenarioSaveRequest = components['schemas']['APISandboxScenarioSaveRequest'];
export type APISandboxScenarioResponse = components['schemas']['APISandboxScenarioResponse'];
export type APISandboxLibraryScenario = components['schemas']['APISandboxLibraryScenario'];
export type APISandboxLibraryScenarioSummary =
  components['schemas']['APISandboxLibraryScenarioSummary'];
type APISandboxLibraryScenarioSaveRequest =
  components['schemas']['APISandboxLibraryScenarioSaveRequest'];
export type APISandboxExampleRequest = components['schemas']['APISandboxExampleRequest'];
export type APISandboxRunReport = components['schemas']['APISandboxRunReport'];
export type APISandboxReceiverInvite = components['schemas']['APISandboxReceiverInvite'];
export type APISandboxReceiverProof = components['schemas']['APISandboxReceiverProof'];
export type APISandboxReceiverCredentials = components['schemas']['APISandboxReceiverCredentials'];
export type APISandboxRunMode = APISandboxRunReport['mode'];
export type APISandboxComparisonReport = components['schemas']['APISandboxComparisonReport'];
export type APISandboxApprovalCheck = components['schemas']['APISandboxApprovalCheck'];

export const isSandboxPartnerInvite = (token: string) => token.startsWith('sbx_inv_');

type Release = { slug: string; deployment: string };

export const releaseSandboxScenarioKey = ({ slug, deployment }: Release) =>
  ['release-api-sandbox-scenario', slug, deployment] as const;

export const sandboxScenarioLibraryKey = (slug: string) =>
  ['api-sandbox-scenario-library', slug] as const;

export const sandboxLibraryScenarioKey = (slug: string, id: string) =>
  [...sandboxScenarioLibraryKey(slug), id] as const;

export function listSandboxLibraryScenarios(slug: string, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/api-sandbox-scenarios', {
      params: { path: { slug } },
      signal,
    })
  );
}

export function getSandboxLibraryScenario(slug: string, id: string, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/api-sandbox-scenarios/{scenario}', {
      params: { path: { slug, scenario: id } },
      signal,
    })
  );
}

export function saveSandboxLibraryScenario(
  slug: string,
  id: string,
  body: APISandboxLibraryScenarioSaveRequest
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/api-sandbox-scenarios/{scenario}', {
      params: { path: { slug, scenario: id } },
      body,
    })
  );
}

export function removeSandboxLibraryScenario(slug: string, id: string, revision: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/api-sandbox-scenarios/{scenario}', {
      params: { path: { slug, scenario: id }, query: { expected_revision: revision } },
    })
  );
}

export function listReleaseSandboxes(release: Release, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/deployments/{deployment}/api-sandboxes', {
      params: { path: release },
      signal,
    })
  );
}

export function getReleaseSandboxScenario(release: Release, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/deployments/{deployment}/api-sandbox-scenario', {
      params: { path: release },
      signal,
    })
  );
}

export function getDebugSandboxScenarioDraft(slug: string, reqId: string, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/debug/requests/{req_id}/sandbox-scenario-draft', {
      params: { path: { slug, req_id: reqId } },
      signal,
    })
  );
}

export function saveReleaseSandboxScenario(release: Release, body: APISandboxScenarioSaveRequest) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/deployments/{deployment}/api-sandbox-scenario', {
      params: { path: release },
      body,
    })
  );
}

export function ensureReleaseSandbox(
  release: Release,
  sandbox: string,
  smokePath: string,
  scenarioRevision?: string,
  partnerLabel?: string
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/deployments/{deployment}/api-sandboxes/{sandbox}', {
      params: { path: { ...release, sandbox } },
      body: {
        smoke_path: smokePath || undefined,
        scenario_revision: scenarioRevision,
        partner_label: partnerLabel,
      },
    })
  );
}

export function endReleaseSandbox(release: Release, sandbox: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/deployments/{deployment}/api-sandboxes/{sandbox}', {
      params: { path: { ...release, sandbox } },
    })
  );
}

export function issueReleaseSandboxInvite(release: Release, sandbox: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/deployments/{deployment}/api-sandboxes/{sandbox}/invites', {
      params: { path: { ...release, sandbox } },
    })
  );
}

export function issueReleaseSandboxPartnerInvite(release: Release, sandbox: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/deployments/{deployment}/api-sandboxes/{sandbox}/partner/invite', {
      params: { path: { ...release, sandbox } },
    })
  );
}

export function revokeReleaseSandboxPartner(release: Release, sandbox: string) {
  return unwrap(
    api.DELETE('/v1/apps/{slug}/deployments/{deployment}/api-sandboxes/{sandbox}/partner', {
      params: { path: { ...release, sandbox } },
    })
  );
}

export function listSandboxApprovalChecks(id: string, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/deployments/{id}/approvals/sandbox-checks', {
      params: { path: { id } },
      signal,
    })
  );
}

export function startSandboxApprovalCheck(
  id: string,
  check: string,
  body: components['schemas']['APISandboxComparisonRequest']
) {
  return unwrap(
    api.PUT('/v1/deployments/{id}/approvals/sandbox-checks/{check}', {
      params: { path: { id, check } },
      body,
    })
  );
}

export function listReleaseSandboxComparisons(release: Release, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/deployments/{deployment}/api-sandbox-comparisons', {
      params: { path: release },
      signal,
    })
  );
}

export function startReleaseSandboxComparison(
  release: Release,
  comparison: string,
  body: components['schemas']['APISandboxComparisonRequest']
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/deployments/{deployment}/api-sandbox-comparisons/{comparison}', {
      params: { path: { ...release, comparison } },
      body,
    })
  );
}

export function listReleaseSandboxRuns(release: Release, signal: AbortSignal) {
  return unwrap(
    api.GET('/v1/apps/{slug}/deployments/{deployment}/api-sandbox-runs', {
      params: { path: release },
      signal,
    })
  );
}

export function startReleaseSandboxRun(
  release: Release,
  run: string,
  scenarioRevision: string,
  mode?: APISandboxRunMode,
  partnerWebhook?: boolean
) {
  return unwrap(
    api.PUT('/v1/apps/{slug}/deployments/{deployment}/api-sandbox-runs/{run}', {
      params: { path: { ...release, run } },
      body: { scenario_revision: scenarioRevision, mode, partner_webhook: partnerWebhook },
    })
  );
}

export function issueReleaseReceiverInvite(
  release: Release,
  run: string,
  scenarioRevision: string
) {
  return unwrap(
    api.POST('/v1/apps/{slug}/deployments/{deployment}/api-sandbox-runs/{run}/receiver-invite', {
      params: { path: { ...release, run } },
      body: { scenario_revision: scenarioRevision },
    })
  );
}

export function issueReleaseSandboxRunInvite(release: Release, run: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/deployments/{deployment}/api-sandbox-runs/{run}/invite', {
      params: { path: { ...release, run } },
    })
  );
}

export function shareReleaseSandboxRun(release: Release, run: string) {
  return unwrap(
    api.POST('/v1/apps/{slug}/deployments/{deployment}/api-sandbox-runs/{run}/report-link', {
      params: { path: { ...release, run } },
    })
  );
}

// The recipient may be signed out. Keep this bearer out of session
// middleware, organization selection, and the console's query cache.
const recipientAPI = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  credentials: 'omit',
  referrerPolicy: 'no-referrer',
  redirect: 'error',
});

export function readSandboxInvite(sandbox: string, token: string, signal: AbortSignal) {
  return unwrap(
    recipientAPI.GET('/v1/api-sandboxes/{sandbox}/invite', {
      params: { path: { sandbox } },
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal,
    })
  );
}

export function redeemSandboxPartnerInvite(sandbox: string, token: string) {
  return unwrap(
    recipientAPI.POST('/v1/api-sandboxes/{sandbox}/redeem', {
      params: { path: { sandbox } },
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  );
}

export function readSharedSandboxRun(run: string, token: string, signal: AbortSignal) {
  return unwrap(
    recipientAPI.GET('/v1/api-sandbox-runs/{run}/report', {
      params: { path: { run } },
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal,
    })
  );
}

export function readSandboxReceiverProof(run: string, token: string, signal: AbortSignal) {
  return unwrap(
    recipientAPI.GET('/v1/api-sandbox-runs/{run}/receiver-invite', {
      params: { path: { run } },
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal,
    })
  );
}

export function verifySandboxReceiver(run: string, token: string, url: string) {
  return unwrap(
    recipientAPI.POST('/v1/api-sandbox-runs/{run}/receiver-invite', {
      params: { path: { run } },
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      body: { url },
    })
  );
}

export function confirmSandboxReceiver(run: string, token: string) {
  return unwrap(
    recipientAPI.POST('/v1/api-sandbox-runs/{run}/receiver-ready', {
      params: { path: { run } },
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
  );
}
