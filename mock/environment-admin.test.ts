import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projects } from './projects';
import { environmentInventory, environmentState } from './environments';
import { mockPromotionToken } from './environment-readiness';
import { registerEnvironmentAdminMocks } from './environment-admin';

/**
 * `src/lib/mock-spec-drift.test.ts` scans `mock/plugin.ts` only, so the same
 * guarantee for the environment mocks — every path exists in the spec — is
 * pinned here, with the handler rules the console's messages depend on.
 */
const SPEC = readFileSync(resolve('api/openapi.yaml'), 'utf8');
const MOCK = readFileSync(resolve('mock/environment-admin.ts'), 'utf8');

class Problem extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}
type Handler = (ctx: {
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  req?: { headers: Record<string, string> };
}) => unknown;

const NO_CONTENT = Symbol('no-content');
const handlers = new Map<string, Handler>();
const slug = projects[0].slug;
registerEnvironmentAdminMocks(
  (method, template, handler) => handlers.set(`${method} ${template}`, handler as Handler),
  Problem,
  NO_CONTENT,
  (_org, project, admin) => {
    if (admin && process.env.MOCK_ORG_ROLE === 'developer')
      throw new Problem(403, 'org_role_forbidden');
    return projects.find((p) => p.slug === project)!;
  }
);
const call = (
  key: string,
  params: Record<string, string>,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) => handlers.get(key)!({ params, query: new URLSearchParams(), body, req: { headers } });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as Problem).code;
  }
  return 'ok';
};

describe('environment admin mocks', () => {
  it('answers only paths the OpenAPI spec defines, each on one line', () => {
    const specPaths = new Set([...SPEC.matchAll(/^ {2}(\/\S+):\s*$/gm)].map((m) => m[1]));
    const mocked = [
      ...MOCK.matchAll(/^\s*route\('(?:GET|POST|PUT|PATCH|DELETE)', '([^']+)'/gm),
    ].map((m) => m[1]);
    expect(mocked).toHaveLength(21);
    expect(mocked.filter((path) => !specPaths.has(path))).toEqual([]);
  });

  it('creates a copy that every environment read then sees, and deletes it', () => {
    const created = call(
      'POST /v1/projects/{slug}/environments',
      { slug },
      { slug: 'preview', from_environment: 'staging' }
    ) as { __status: number; body: { cloned_from: string } };
    expect(created.__status).toBe(201);
    expect(created.body.cloned_from).toBe('staging');
    expect(environmentInventory(slug)?.map((e) => e.slug)).toContain('preview');
    expect(environmentState(slug, 'preview')?.configuration.values).toEqual({
      region: 'eu',
      stage: 'staging',
    });
    expect(
      code(() => call('POST /v1/projects/{slug}/environments', { slug }, { slug: 'preview' }))
    ).toBe('conflict');
    expect(
      call('DELETE /v1/projects/{slug}/environments/{environment}', {
        slug,
        environment: 'preview',
      })
    ).toBe(NO_CONTENT);
    expect(environmentInventory(slug)?.map((e) => e.slug)).not.toContain('preview');
  });

  it('refuses to delete production or a protected environment', () => {
    expect(
      code(() =>
        call('DELETE /v1/projects/{slug}/environments/{environment}', {
          slug,
          environment: 'production',
        })
      )
    ).toBe('conflict');
  });

  it('appends a configuration version and refuses secret-shaped keys', () => {
    const saved = call(
      'PUT /v1/projects/{slug}/environments/{environment}/config',
      { slug, environment: 'staging' },
      { values: { LOG_LEVEL: 'debug' } }
    ) as { version: number };
    expect(saved.version).toBe(2);
    expect(environmentState(slug, 'staging')?.configuration.version).toBe(2);
    expect(
      code(() =>
        call(
          'PUT /v1/projects/{slug}/environments/{environment}/config',
          { slug, environment: 'staging' },
          { values: { STRIPE_API_KEY: 'x' } }
        )
      )
    ).toBe('validation_failed');
  });

  it('keeps secret values write-only and rotates only existing keys', () => {
    const params = { slug, environment: 'staging', key: 'PAYMENTS_KEY' };
    expect(
      code(() =>
        call('POST /v1/projects/{slug}/environments/{environment}/secrets/{key}/rotate', params, {
          value: 'x',
        })
      )
    ).toBe('not_found');
    const set = call('PUT /v1/projects/{slug}/environments/{environment}/secrets/{key}', params, {
      value: 'secret-value',
    });
    expect(JSON.stringify(set)).not.toContain('secret-value');
  });

  it('promotes into a protected environment only with an approval of the same token', () => {
    const token = mockPromotionToken(slug, 'staging', 'production');
    const target = { slug, environment: 'production' };
    const promote = (body: Record<string, unknown>, key = 'k1') =>
      call('POST /v1/projects/{slug}/environments/{environment}/promote', target, body, {
        'idempotency-key': key,
      });
    expect(code(() => promote({ from_environment: 'staging', promotion_token: token }))).toBe(
      'project_environment_approval_required'
    );
    const approval = call('POST /v1/projects/{slug}/environments/{environment}/approvals', target, {
      promotion_token: token,
    }) as { body: { approval_token: string } };
    const result = promote({
      from_environment: 'staging',
      promotion_token: token,
      approval_token: approval.body.approval_token,
    }) as { promotion_id: string; status: string };
    expect(result.status).toBe('succeeded');
    // The same key replays the same operation instead of starting another.
    expect((promote({}) as { promotion_id: string }).promotion_id).toBe(result.promotion_id);
    const rolled = call(
      'POST /v1/projects/{slug}/environments/{environment}/promotions/{promotion}/rollback',
      { ...target, promotion: result.promotion_id }
    ) as { rollback_status: string };
    expect(rolled.rollback_status).toBe('rolled_back');
  });

  it('creates company environments empty and needs an admin to protect one', () => {
    const org = { organization: 'acme-corp', slug };
    expect(
      code(() =>
        call('POST /v1/orgs/{organization}/projects/{slug}/environments', org, {
          slug: 'copy',
          from_environment: 'staging',
        })
      )
    ).toBe('conflict');
    process.env.MOCK_ORG_ROLE = 'developer';
    try {
      expect(
        code(() =>
          call(
            'PATCH /v1/orgs/{organization}/projects/{slug}/environments/{environment}',
            { ...org, environment: 'staging' },
            { protected: true }
          )
        )
      ).toBe('org_role_forbidden');
    } finally {
      delete process.env.MOCK_ORG_ROLE;
    }
  });
});
