import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyMigrationPlan, scanMigrationProject } from './project-migration';

const post = vi.hoisted(() => vi.fn());
vi.mock('./client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./client')>()),
  api: { POST: post },
}));
afterEach(() => vi.resetAllMocks());

describe('migration API', () => {
  it('scans connected source in manual migration mode with an explicit service selection', async () => {
    const data = { plan_token: 'reviewed' };
    post.mockResolvedValue({ data, response: new Response('{}') });
    const controller = new AbortController();
    expect(
      await scanMigrationProject(
        { repo: 'team/shop', ref: 'release', projectSlug: 'shop' },
        ['api'],
        controller.signal,
        { api: 'shop-backend' }
      )
    ).toBe(data);
    expect(post).toHaveBeenCalledWith('/v1/projects/scan/source-ref', {
      body: {
        repo: 'team/shop',
        ref: 'release',
        project_slug: 'shop',
        only: ['api'],
        migration: true,
        app_slugs: { api: 'shop-backend' },
      },
      signal: controller.signal,
    });
  });
  it('applies the reviewed archive with the caller retry key and request-only configuration', async () => {
    post.mockResolvedValue({ data: { project_id: 'project' }, response: new Response('{}') });
    const body = {
      plan_token: 'reviewed',
      only: ['api'],
      initial_secrets: { api: { DATABASE_URL: 'transient' } },
    };
    await applyMigrationPlan(body, 'logical-action');
    expect(post).toHaveBeenCalledWith('/v1/projects/apply-plan', {
      body,
      headers: { 'Idempotency-Key': 'logical-action' },
    });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
