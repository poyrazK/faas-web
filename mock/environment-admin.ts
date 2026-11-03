import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { projects } from './projects';
import {
  configHash,
  diffFor,
  environmentConfig,
  environmentConfigs,
  environmentEdits,
  inventoryFor,
  stateFor,
} from './environments';
import {
  mockPromotionPreview,
  mockPromotionToken,
  recordedPromotions,
} from './environment-readiness';

/**
 * Dev-mock answers for managing project environments: create, protect and
 * delete; shared configuration and shared secrets; approving and running a
 * promotion and rolling it back (faas handlers_projects.go:331-640,
 * handlers_project_environment_config.go, ADR-1139,
 * handlers_project_environment_approvals.go,
 * handlers_project_environment_promotion.go); and the company-project reads
 * and writes under `/v1/orgs/{organization}/projects/{slug}/environments…`
 * (org_project_routes.go). Reads of a personal project's environments stay in
 * mock/plugin.ts; every one of them sees the edits made here.
 */

type S = components['schemas'];
type Project = S['ProjectResponse'];
interface MockCtx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  req?: { headers: Record<string, string | string[] | undefined> };
}
type Register = (method: string, template: string, handler: (ctx: MockCtx) => unknown) => void;
type ProblemCtor = new (status: number, code: string, detail?: string) => Error;
/** Resolves a company project, checking the caller's role (owner or admin when `admin`). */
type CompanyProject = (organization: string, slug: string, admin: boolean) => Project;

const ENV = /^[a-z0-9](?:[a-z0-9-]{0,31}[a-z0-9])?$/;
const KEY = /^[A-Z][A-Z0-9_]*$/;
const SECRET_SHAPED = /(_TOKEN|_PASSWORD|_SECRET|_API_KEY)$/;
const status = (code: number, body: unknown) => ({ __status: code, body });
const now = () => new Date().toISOString();

interface StoredSecret {
  key: string;
  version: number;
  kid: string;
  value_hash: string;
  created_at: string;
  updated_at: string;
}
const secrets = new Map<string, StoredSecret[]>();
const secretsOf = (project: string, environment: string) => {
  const id = `${project}/${environment}`;
  if (!secrets.has(id))
    secrets.set(
      id,
      db.EMPTY || environment !== 'production'
        ? []
        : [
            {
              key: 'DATABASE_PASSWORD',
              version: 2,
              kid: 'fleet-2026-10',
              value_hash: 'e'.repeat(64),
              created_at: db.iso(20 * 86_400_000),
              updated_at: db.iso(3 * 86_400_000),
            },
          ]
    );
  return secrets.get(id)!;
};
const fingerprint = (value: string) => configHash({ value });
const approvals = new Map<string, string>();

export function registerEnvironmentAdminMocks(
  route: Register,
  Problem: ProblemCtor,
  NO_CONTENT: symbol,
  companyProject: CompanyProject
) {
  const personal = (slug: string) => {
    const project = projects.find((p) => p.slug === slug);
    if (!project) throw new Problem(404, 'not_found', `no project exists with slug ${slug}`);
    return project;
  };
  const registered = (project: Project, environment: string) => {
    const env = inventoryFor(project).find((e) => e.slug === environment);
    if (!env)
      throw new Problem(404, 'not_found', `project environment ${environment} does not exist`);
    return env;
  };

  const create = (project: Project, body: Record<string, unknown>, company: boolean) => {
    const slug = String(body.slug ?? '').trim();
    const from = String(body.from_environment ?? '').trim();
    if (!ENV.test(slug) || slug === 'default')
      throw new Problem(400, 'validation_failed', 'slug must be a lowercase environment name');
    if (company && (from || body.full))
      throw new Problem(
        409,
        'conflict',
        'company environments are created empty until shared resource cloning is supported'
      );
    if (from) registered(project, from);
    if (body.share_resources && !from)
      throw new Problem(
        400,
        'validation_failed',
        'share_resources is only valid when cloning with from_environment'
      );
    if (inventoryFor(project).some((e) => e.slug === slug))
      throw new Problem(409, 'conflict', 'the project already has an environment with this slug');
    const edit = environmentEdits(project.slug);
    edit.removed.delete(slug);
    const created: S['ProjectEnvironmentResponse'] = {
      id: db.id(),
      project_id: project.id,
      slug,
      protected: Boolean(body.protected),
      created_at: now(),
      updated_at: now(),
      ...(from ? { cloned_from: from } : {}),
    };
    edit.added.push(created);
    if (from) {
      const source = environmentConfig(project.slug, from);
      environmentConfigs.set(`${project.slug}/${slug}`, { ...source, updated_at: now() });
      secrets.set(
        `${project.slug}/${slug}`,
        secretsOf(project.slug, from).map((s) => ({ ...s }))
      );
    }
    return status(201, created);
  };
  const protect = (project: Project, environment: string, body: Record<string, unknown>) => {
    const env = registered(project, environment);
    if (typeof body.protected !== 'boolean')
      throw new Problem(400, 'validation_failed', 'protected is required');
    environmentEdits(project.slug).protection.set(env.slug, body.protected);
    return { ...env, protected: body.protected, updated_at: now() };
  };
  const remove = (project: Project, environment: string) => {
    const env = registered(project, environment);
    const live = stateFor(project, environment)?.workloads.some((w) => w.release.status === 'live');
    if (env.slug === 'production' || env.protected || live)
      throw new Problem(
        409,
        'conflict',
        'only unprotected, non-production environments without live releases can be deleted'
      );
    const edit = environmentEdits(project.slug);
    edit.added = edit.added.filter((e) => e.slug !== env.slug);
    edit.removed.add(env.slug);
    environmentConfigs.delete(`${project.slug}/${env.slug}`);
    secrets.delete(`${project.slug}/${env.slug}`);
    return NO_CONTENT;
  };
  const config = (project: Project, environment: string): S['ProjectEnvironmentConfigResponse'] => {
    registered(project, environment);
    const current = environmentConfig(project.slug, environment);
    return {
      project_slug: project.slug,
      environment,
      version: current.version,
      config_hash: configHash(current.values),
      values: current.values,
      updated_at: current.updated_at,
    };
  };
  const writeConfig = (project: Project, environment: string, body: Record<string, unknown>) => {
    registered(project, environment);
    const values = body.values;
    if (!values || typeof values !== 'object' || Array.isArray(values))
      throw new Problem(400, 'validation_failed', 'values must be a JSON object');
    const shaped = Object.keys(values).find((k) => SECRET_SHAPED.test(k));
    if (shaped)
      throw new Problem(
        400,
        'validation_failed',
        `${shaped} looks like a secret; set it as a shared secret instead`
      );
    const current = environmentConfig(project.slug, environment);
    environmentConfigs.set(`${project.slug}/${environment}`, {
      version: current.version + 1,
      values: values as Record<string, unknown>,
      updated_at: now(),
    });
    return config(project, environment);
  };

  // --- Personal projects -------------------------------------------------------
  // prettier-ignore
  route('POST', '/v1/projects/{slug}/environments', ({ params, body }) =>
    create(personal(params.slug), body, false)
  );
  // prettier-ignore
  route('PATCH', '/v1/projects/{slug}/environments/{environment}', ({ params, body }) =>
    protect(personal(params.slug), params.environment, body)
  );
  // prettier-ignore
  route('DELETE', '/v1/projects/{slug}/environments/{environment}', ({ params }) =>
    remove(personal(params.slug), params.environment)
  );
  // prettier-ignore
  route('GET', '/v1/projects/{slug}/environments/{environment}/config', ({ params }) =>
    config(personal(params.slug), params.environment)
  );
  // prettier-ignore
  route('PUT', '/v1/projects/{slug}/environments/{environment}/config', ({ params, body }) =>
    writeConfig(personal(params.slug), params.environment, body)
  );
  // prettier-ignore
  route('GET', '/v1/projects/{slug}/environments/{environment}/secrets', ({ params }) => {
    const project = personal(params.slug);
    registered(project, params.environment);
    return {
      project_slug: project.slug,
      environment: params.environment,
      secrets: secretsOf(project.slug, params.environment),
      limit: 50,
    } satisfies S['ProjectEnvironmentSharedSecretsResponse'];
  });
  const writeSecret = (
    params: Record<string, string>,
    body: Record<string, unknown>,
    rotate: boolean
  ) => {
    const project = personal(params.slug);
    registered(project, params.environment);
    if (!KEY.test(params.key)) throw new Problem(400, 'validation_failed', 'invalid secret key');
    const value = String(body.value ?? '');
    if (!value) throw new Problem(400, 'validation_failed', 'value is required');
    const list = secretsOf(project.slug, params.environment);
    const existing = list.find((s) => s.key === params.key);
    if (rotate && !existing) throw new Problem(404, 'not_found', 'no shared secret with that key');
    if (!existing && list.length >= 50)
      throw new Problem(
        403,
        'plan_limit_project_secrets',
        'Your plan allows 50 shared secrets per environment.'
      );
    const stored: StoredSecret = existing
      ? Object.assign(existing, {
          version: existing.version + 1,
          value_hash: fingerprint(value),
          updated_at: now(),
        })
      : {
          key: params.key,
          version: 1,
          kid: 'fleet-2026-10',
          value_hash: fingerprint(value),
          created_at: now(),
          updated_at: now(),
        };
    if (!existing) list.push(stored);
    return { project_slug: project.slug, environment: params.environment, secret: stored };
  };
  // prettier-ignore
  route('PUT', '/v1/projects/{slug}/environments/{environment}/secrets/{key}', ({ params, body }) =>
    writeSecret(params, body, false)
  );
  // prettier-ignore
  route('POST', '/v1/projects/{slug}/environments/{environment}/secrets/{key}/rotate', ({ params, body }) =>
    writeSecret(params, body, true)
  );
  // prettier-ignore
  route('DELETE', '/v1/projects/{slug}/environments/{environment}/secrets/{key}', ({ params }) => {
    const project = personal(params.slug);
    const list = secretsOf(project.slug, params.environment);
    const index = list.findIndex((s) => s.key === params.key);
    if (index < 0) throw new Problem(404, 'not_found', 'no shared secret with that key');
    list.splice(index, 1);
    return NO_CONTENT;
  });

  const tokenParts = (token: string) => {
    const [kind, project, source, target] = token.split(':');
    return kind === 'mock-promotion' ? { project, source, target } : undefined;
  };
  // prettier-ignore
  route('POST', '/v1/projects/{slug}/environments/{environment}/approvals', ({ params, body }) => {
    const project = personal(params.slug);
    const env = registered(project, params.environment);
    if (!env.protected)
      throw new Problem(409, 'project_environment_approval_invalid', 'approvals are only required for protected project environments');
    const parts = tokenParts(String(body.promotion_token ?? ''));
    if (!parts || parts.project !== project.slug || parts.target !== env.slug)
      throw new Problem(409, 'project_environment_approval_invalid', 'approve the exact promotion preview for this project and environment');
    const token = `mock-approval-${db.id()}`;
    approvals.set(token, String(body.promotion_token));
    return status(201, {
      approval_id: crypto.randomUUID(),
      approval_token: token,
      environment: env.slug,
      token_kind: 'promotion',
      status: 'pending',
      expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
    } satisfies S['ProjectEnvironmentApprovalResponse']);
  });
  // prettier-ignore
  route('POST', '/v1/projects/{slug}/environments/{environment}/promote', ({ params, body, req }) => {
    const project = personal(params.slug);
    const env = registered(project, params.environment);
    const key = req?.headers['idempotency-key'];
    if (!key) throw new Problem(400, 'validation_failed', 'environment promotions require an Idempotency-Key');
    const replay = recordedPromotions.find((p) => p.promotion_id === `mock-${key}`);
    if (replay) return replay;
    const source = String(body.from_environment ?? '');
    const token = String(body.promotion_token ?? '');
    const parts = tokenParts(token);
    const preview = mockPromotionPreview(project.slug, env.slug, source);
    if (!parts || !preview || token !== mockPromotionToken(project.slug, source, env.slug))
      throw new Problem(409, 'project_environment_approval_invalid', 'preview the exact source and target environments again');
    if (!preview.can_promote)
      throw new Problem(409, 'validation_failed', preview.blocking_reasons?.join('; '));
    if (preview.approval_required) {
      const approval = String(body.approval_token ?? '');
      if (!approval)
        throw new Problem(409, 'project_environment_approval_required', 'approve this exact promotion before executing it');
      if (approvals.get(approval) !== token)
        throw new Problem(409, 'project_environment_approval_invalid', 'the approval does not match this promotion');
      approvals.delete(approval);
    }
    const promotion: S['ProjectEnvironmentPromotionStatusResponse'] = {
      promotion_id: `mock-${key}`,
      project_slug: project.slug,
      from_environment: source,
      to_environment: env.slug,
      promotion_hash: preview.promotion_hash,
      status: 'succeeded',
      verification_status: 'verified',
      sync_config: false,
      created_at: now(),
      updated_at: now(),
      completed_at: now(),
      workloads: preview.changes.map((c) => ({
        workload_slug: c.workload_slug,
        workload_name: c.workload_name,
        status: 'promoted',
        verification_status: 'verified',
        ...(c.target_deployment_id ? { previous_target_deployment_id: c.target_deployment_id } : {}),
      })),
    };
    recordedPromotions.unshift(promotion);
    return promotion;
  });
  // prettier-ignore
  route('POST', '/v1/projects/{slug}/environments/{environment}/promotions/{promotion}/rollback', ({ params }) => {
    const promotion = recordedPromotions.find(
      (p) => p.project_slug === params.slug && p.to_environment === params.environment && p.promotion_id === params.promotion
    );
    if (!promotion) throw new Problem(404, 'not_found', 'no promotion with that id');
    if (promotion.rollback_status === 'rolled_back')
      throw new Problem(409, 'conflict', 'the promotion was already rolled back');
    Object.assign(promotion, {
      rollback_status: 'rolled_back',
      rollback_started_at: now(),
      rollback_completed_at: now(),
      updated_at: now(),
      workloads: promotion.workloads.map((w) => ({ ...w, rollback_status: 'restored' as const })),
    });
    return promotion;
  });

  // --- Company projects --------------------------------------------------------
  const org = (params: Record<string, string>, admin = false) =>
    companyProject(params.organization, params.slug, admin);
  // prettier-ignore
  route('GET', '/v1/orgs/{organization}/projects/{slug}/environments', ({ params }) =>
    inventoryFor(org(params))
  );
  // prettier-ignore
  route('POST', '/v1/orgs/{organization}/projects/{slug}/environments', ({ params, body }) =>
    create(org(params, Boolean(body.protected)), body, true)
  );
  // prettier-ignore
  route('GET', '/v1/orgs/{organization}/projects/{slug}/environments/{environment}', ({ params }) =>
    registered(org(params), params.environment)
  );
  // prettier-ignore
  route('PATCH', '/v1/orgs/{organization}/projects/{slug}/environments/{environment}', ({ params, body }) =>
    protect(org(params, true), params.environment, body)
  );
  // prettier-ignore
  route('DELETE', '/v1/orgs/{organization}/projects/{slug}/environments/{environment}', ({ params }) =>
    remove(org(params, true), params.environment)
  );
  // prettier-ignore
  route('GET', '/v1/orgs/{organization}/projects/{slug}/environments/{environment}/state', ({ params }) => {
    const state = stateFor(org(params), params.environment);
    if (!state) throw new Problem(404, 'not_found', 'Environment not found.');
    return state;
  });
  // prettier-ignore
  route('GET', '/v1/orgs/{organization}/projects/{slug}/environments/{environment}/diff', ({ params, query }) => {
    const diff = diffFor(org(params), query.get('from') ?? '', params.environment);
    if (!diff) throw new Problem(404, 'not_found', 'Both environments must be registered.');
    return diff;
  });
  // prettier-ignore
  route('GET', '/v1/orgs/{organization}/projects/{slug}/environments/{environment}/config', ({ params }) =>
    config(org(params), params.environment)
  );
  // prettier-ignore
  route('PUT', '/v1/orgs/{organization}/projects/{slug}/environments/{environment}/config', ({ params, body }) =>
    writeConfig(org(params), params.environment, body)
  );
}
