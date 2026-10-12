import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import {
  readPromotionPreview,
  readPromotionHistory,
  readPromotionReceipt,
  readApprovalReceipt,
  usePromotionPreview,
} from './environment-readiness';
afterEach(() => vi.restoreAllMocks());
const identity = { accountId: 'a', projectId: 'p', project: 'shop', target: 'production' };
const hash = 'a'.repeat(64);
const preview = {
  project_slug: 'shop',
  from_environment: 'staging',
  to_environment: 'production',
  can_promote: false,
  to_environment_protected: true,
  approval_required: true,
  qualification_required: true,
  release_graph_mode: true,
  promotion_hash: hash,
  promotion_token: 'never-retain',
  blocking_reasons: ['Qualification expired'],
  config_diff: {
    project_slug: 'shop',
    from_environment: 'staging',
    to_environment: 'production',
    from_version: 3,
    to_version: 4,
    from_hash: hash,
    to_hash: 'b'.repeat(64),
    changes: [{ before: 'never-retain' }],
  },
  changes: [
    {
      workload_slug: 'api',
      workload_name: 'api',
      kind: 'changed',
      source_revision: 'exact-source',
      target_revision: 'exact-target',
      source_workload_config_hash: hash,
      target_workload_config_hash: 'b'.repeat(64),
      env: { TOKEN: 'never-retain' },
    },
  ],
  qualification: {
    id: 'q',
    environment: 'staging',
    release_set_id: 'release',
    status: 'passed',
    configuration_version: 3,
    configuration_hash: hash,
    secret_revision_hashes: { api: hash },
    created_at: '2026-10-10T00:00:00Z',
    expires_at: '2026-10-11T00:00:00Z',
    checks: [],
    approval_token: 'never-retain',
  },
};
function mock(result: unknown) {
  return vi
    .spyOn(api, 'GET')
    .mockImplementation(
      async (path) =>
        ({
          data:
            path === '/v1/account'
              ? { id: 'a' }
              : path === '/v1/projects/{slug}'
                ? { id: 'p', slug: 'shop' }
                : result,
          response: new Response(),
        }) as never
    );
}
it('caches only safe source/target/qualification/config identities, excluding tokens and config values', async () => {
  mock(preview);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => usePromotionPreview(identity, 'staging'), { wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.data?.changes[0].source_revision).toBe('exact-source');
  expect(hook.result.current.data?.qualification?.expires_at).toBe('2026-10-11T00:00:00Z');
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data)
    )
  ).not.toMatch(/never-retain|promotion_token|approval_token|before/);
});
it.each(['project_slug', 'from_environment', 'to_environment'])(
  'rejects mismatched preview %s',
  async (field) => {
    mock({ ...preview, [field]: 'other' });
    await expect(readPromotionPreview(identity, 'staging')).rejects.toThrow(/identity|context/i);
  }
);
it('rejects an account change after a read and forwards cancellation', async () => {
  let reads = 0;
  vi.spyOn(api, 'GET').mockImplementation(
    async (path) =>
      ({
        data:
          path === '/v1/account'
            ? { id: ++reads > 1 ? 'other' : 'a' }
            : path === '/v1/projects/{slug}'
              ? { id: 'p', slug: 'shop' }
              : preview,
        response: new Response(),
      }) as never
  );
  await expect(readPromotionPreview(identity, 'staging')).rejects.toThrow(/context/i);
  const c = new AbortController();
  c.abort();
  await expect(readPromotionPreview(identity, 'staging', c.signal)).rejects.toThrow();
});
const receipt = {
  promotion_id: 'operation',
  project_slug: 'shop',
  from_environment: 'staging',
  to_environment: 'production',
  promotion_hash: hash,
  status: 'failed',
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T01:00:00Z',
  verification_status: 'failed',
  rollback_status: 'blocked',
  error: 'never-retain',
  workloads: [
    {
      workload_slug: 'api',
      workload_name: 'api',
      status: 'applied',
      target_deployment_id: 'target',
      verification_status: 'failed',
      rollback_status: 'blocked',
      env: { TOKEN: 'never-retain' },
      error: 'never-retain',
    },
  ],
};
it('reads bounded filter-scoped history with an opaque cursor and strips raw failures', async () => {
  const get = mock({ items: [receipt], next_before: 'opaque|cursor' });
  const result = await readPromotionHistory(identity, {
    source: 'staging',
    status: 'failed',
    before: 'opaque|previous',
  });
  expect(result.nextBefore).toBe('opaque|cursor');
  expect(JSON.stringify(result)).not.toContain('never-retain');
  expect(get).toHaveBeenCalledWith(
    '/v1/projects/{slug}/environments/{environment}/promotions',
    expect.objectContaining({
      params: {
        path: { slug: 'shop', environment: 'production' },
        query: { limit: 25, from: 'staging', status: 'failed', before: 'opaque|previous' },
      },
      signal: undefined,
    })
  );
});
it('preserves durable partial/verification/rollback facts without inventing execution success', async () => {
  mock(receipt);
  const result = await readPromotionReceipt(identity, 'operation');
  expect(result.status).toBe('failed');
  expect(result.workloads[0].status).toBe('applied');
  expect(result.verification_status).toBe('failed');
  expect(result.rollback_status).toBe('blocked');
  expect(JSON.stringify(result)).not.toContain('never-retain');
});
it('rejects foreign operation identity and object IDs before retaining them', async () => {
  const get = mock({ ...receipt, promotion_id: { env: { TOKEN: 'never-retain' } } });
  await expect(readPromotionReceipt(identity, 'operation')).rejects.toThrow(/identity/i);
  get.mockRestore();
  mock({ items: [{ ...receipt, to_environment: 'staging' }] });
  await expect(readPromotionHistory(identity, {})).rejects.toThrow(/identity/i);
});
it('uses returned approval expiry/consumption and never caches a raw token', async () => {
  mock({
    approval_id: 'approval',
    environment: 'production',
    token_kind: 'promotion',
    status: 'expired',
    created_at: '2026-10-10T00:00:00Z',
    expires_at: '2026-10-11T00:00:00Z',
    approval_token: 'never-retain',
  });
  const result = await readApprovalReceipt(identity, 'approval');
  expect(result.status).toBe('expired');
  expect(result.approval_id).toBe('approval');
  expect(JSON.stringify(result)).not.toContain('never-retain');
});
