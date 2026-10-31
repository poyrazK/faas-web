import type { ServicePolicyPatch } from './api/bindings';
import type { App } from './api/queries';

export interface ServicePolicyDraft {
  callerMode: 'account' | 'deny' | 'allow';
  callers: string;
  scopeMode: 'clear' | 'deny' | 'rules';
  scopesJson: string;
  targets: string;
  policy: 'account' | 'declared';
  transport: 'http' | 'https';
  allowForwardTargets: boolean;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const METHOD = /^(?:[A-Z]+|\*)$/;

function parseSlugs(input: string): string[] {
  return [
    ...new Set(
      input
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean)
    ),
  ];
}

export function servicePolicyFingerprint(app: App): string {
  return JSON.stringify({
    id: app.id,
    callers: app.allowed_service_callers ?? null,
    scopes: app.allowed_service_call_scopes ?? null,
    targets: (app.service_bindings ?? []).map((binding) => binding.service).sort(),
    policy: app.service_binding_policy ?? 'account',
    transport: app.service_binding_transport ?? 'http',
  });
}

export function draftFromServicePolicy(app: App): ServicePolicyDraft {
  const callers = app.allowed_service_callers;
  const scopes = app.allowed_service_call_scopes;
  return {
    callerMode: callers === undefined ? 'account' : callers.length ? 'allow' : 'deny',
    callers: callers?.join('\n') ?? '',
    scopeMode: scopes === undefined ? 'clear' : Object.keys(scopes).length ? 'rules' : 'deny',
    scopesJson: scopes && Object.keys(scopes).length ? JSON.stringify(scopes, null, 2) : '',
    targets: (app.service_bindings ?? []).map((binding) => binding.service).join('\n'),
    policy: app.service_binding_policy ?? 'account',
    transport: app.service_binding_transport ?? 'http',
    allowForwardTargets: false,
  };
}

export function buildServicePolicyPatch(
  draft: ServicePolicyDraft,
  ownedApps: string[]
): { patch?: ServicePolicyPatch; forwardTargets: string[]; error?: string } {
  const known = new Set(ownedApps);
  const callers = parseSlugs(draft.callers);
  const targets = parseSlugs(draft.targets);
  for (const slug of [...(draft.callerMode === 'allow' ? callers : []), ...targets]) {
    if (!SLUG.test(slug) || slug.endsWith('-'))
      return { forwardTargets: [], error: `Invalid app slug: ${slug}` };
  }
  if (draft.callerMode === 'allow') {
    if (callers.length === 0) return { forwardTargets: [], error: 'Choose at least one caller.' };
    const unknown = callers.find((caller) => !known.has(caller));
    if (unknown) return { forwardTargets: [], error: `Unknown caller: ${unknown}` };
  }
  const forwardTargets = targets.filter((target) => !known.has(target));
  if (forwardTargets.length && !draft.allowForwardTargets)
    return {
      forwardTargets,
      error: `Future target ${forwardTargets.join(', ')} needs explicit review.`,
    };

  let scopes: ServicePolicyPatch['allowed_service_call_scopes'] = null;
  if (draft.scopeMode === 'deny') scopes = {};
  if (draft.scopeMode === 'rules') {
    let raw: unknown;
    try {
      raw = JSON.parse(draft.scopesJson);
    } catch {
      return { forwardTargets, error: 'Scoped grants must be valid JSON.' };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).length)
      return { forwardTargets, error: 'Scoped grants need a caller map.' };
    for (const [caller, scope] of Object.entries(raw)) {
      if (!known.has(caller)) return { forwardTargets, error: `Unknown caller: ${caller}` };
      if (!scope || typeof scope !== 'object' || Array.isArray(scope))
        return { forwardTargets, error: `Invalid grants for ${caller}.` };
      const entry = scope as Record<string, unknown>;
      if (
        !Array.isArray(entry.methods) ||
        !entry.methods.length ||
        !entry.methods.every((method) => typeof method === 'string' && METHOD.test(method))
      )
        return { forwardTargets, error: `Invalid methods for ${caller}.` };
      if (
        !Array.isArray(entry.path_prefixes) ||
        !entry.path_prefixes.length ||
        !entry.path_prefixes.every(
          (path) =>
            typeof path === 'string' &&
            path.startsWith('/') &&
            !path.includes('//') &&
            !path.includes('..')
        )
      )
        return { forwardTargets, error: `Invalid path prefix for ${caller}.` };
    }
    scopes = raw as NonNullable<ServicePolicyPatch['allowed_service_call_scopes']>;
  }
  return {
    forwardTargets,
    patch: {
      allowed_service_callers:
        draft.callerMode === 'account' ? null : draft.callerMode === 'deny' ? [] : callers,
      allowed_service_call_scopes: scopes,
      service_binding_targets: targets,
      service_binding_policy: draft.policy,
      service_binding_transport: draft.transport,
    },
  };
}
