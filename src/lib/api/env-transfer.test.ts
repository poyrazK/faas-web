import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';
import { applyEnvImport, fetchEnvExport } from './env-transfer';
const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) }) as never;
beforeEach(() => vi.restoreAllMocks());
describe('env transfer requests', () => {
  it('reports partial success and preserves app/scope for each single-key write', async () => {
    const put = vi
      .spyOn(api, 'PUT')
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
    const put = vi.spyOn(api, 'PUT').mockImplementation(async () => {
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
  it('exports only on demand with explicit acknowledgement and no-store', async () => {
    const post = vi
      .spyOn(api, 'POST')
      .mockResolvedValue(
        ok({ app_slug: 'alpha', scope: 'default', values: { A: 'private\nvalue' } })
      );
    expect(post).not.toHaveBeenCalled();
    expect(await fetchEnvExport('alpha', 'default')).toBe('A="private\\nvalue"\n');
    expect(post).toHaveBeenCalledWith(
      '/v1/apps/{slug}/env-export',
      expect.objectContaining({
        params: { path: { slug: 'alpha' }, query: { scope: 'default' } },
        body: { acknowledge_sensitive_values: true },
        cache: 'no-store',
      })
    );
  });
  it('rejects mismatched context and denied downloads without producing a file', async () => {
    vi.spyOn(api, 'POST')
      .mockResolvedValueOnce(ok({ app_slug: 'other', scope: 'default', values: { A: 'private' } }))
      .mockResolvedValueOnce({
        error: { status: 403, code: 'forbidden', title: 'Export denied' },
        response: new Response(null, { status: 403 }),
      } as never);
    await expect(fetchEnvExport('alpha', 'default')).rejects.toThrow('different app or scope');
    await expect(fetchEnvExport('alpha', 'default')).rejects.toThrow('Export denied');
  });
  it('rejects all-scope exports before issuing a request', async () => {
    const post = vi.spyOn(api, 'POST');
    await expect(fetchEnvExport('alpha', '__all__')).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  });
});
