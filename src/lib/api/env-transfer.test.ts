import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEnvImport } from './env-transfer';
import { spyApi } from '@/test/api';
const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) }) as never;
beforeEach(() => vi.restoreAllMocks());
describe('env transfer requests', () => {
  it('reports partial success and preserves app/scope for each single-key write', async () => {
    const put = spyApi('PUT')
      .mockResolvedValueOnce(ok({}))
      .mockResolvedValueOnce({
        error: { status: 403, code: 'plan_limit_env_vars', title: 'Quota exceeded' },
        response: new Response(null, { status: 403 }),
      } as never)
      .mockResolvedValueOnce(ok({}));
    const result = await applyEnvImport('alpha', 'staging', [
      { key: 'A', value: 'private-one' },
      { key: 'B', value: 'private-two' },
      { key: 'C', value: 'private-three' },
    ]);
    expect(result).toEqual({
      saved: ['A', 'C'],
      failed: [{ key: 'B', message: 'Quota exceeded' }],
    });
    expect(put).toHaveBeenCalledTimes(3);
    expect(put).toHaveBeenNthCalledWith(
      2,
      '/v1/apps/{slug}/env/{key}',
      expect.objectContaining({
        params: { path: { slug: 'alpha', key: 'B' }, query: { scope: 'staging' } },
      })
    );
    expect(JSON.stringify(result)).not.toContain('private-');
  });
  it('does not dispatch writes after an import is aborted', async () => {
    const controller = new AbortController();
    const put = spyApi('PUT').mockImplementation(async () => {
      controller.abort();
      return ok({});
    });
    await applyEnvImport(
      'alpha',
      'default',
      [
        { key: 'A', value: 'one' },
        { key: 'B', value: 'two' },
      ],
      controller.signal
    );
    expect(put).toHaveBeenCalledTimes(1);
  });
});
