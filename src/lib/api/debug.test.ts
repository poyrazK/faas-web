import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportDebugRequests, tidyDuration } from './debug';

const get = vi.hoisted(() => vi.fn());
vi.mock('./client', async (original) => ({ ...(await original<object>()), api: { GET: get } }));
beforeEach(() => get.mockReset());

describe('tidyDuration', () => {
  it('drops the empty units Go prints', () => {
    expect(tidyDuration('24h0m0s')).toBe('24h');
    expect(tidyDuration('1h30m0s')).toBe('1h30m');
    expect(tidyDuration('30m0s')).toBe('30m');
    expect(tidyDuration('45s')).toBe('45s');
    expect(tidyDuration(null)).toBeNull();
  });
});

describe('exportDebugRequests', () => {
  it('hands back apid’s own file, filename and window', async () => {
    const blob = new Blob(['{"id":"r1"}\n'], { type: 'application/x-ndjson' });
    const response = new Response('{"id":"r1"}\n', {
      status: 200,
      headers: {
        'Content-Disposition': 'attachment; filename="api-requests-20261103.ndjson"',
        'X-Faas-Request-Log-Window': '72h0m0s',
        'X-Faas-Request-Log-Retention-Clamped': 'true',
      },
    });
    get.mockResolvedValue({ data: blob, response });
    const file = await exportDebugRequests('api', { since: '7d', format: 'ndjson' });
    expect(get).toHaveBeenCalledWith('/v1/apps/{slug}/debug/requests/export', {
      params: { path: { slug: 'api' }, query: { since: '7d', format: 'ndjson' } },
      parseAs: 'blob',
    });
    expect(file.blob).toBe(blob);
    expect(file.filename).toBe('api-requests-20261103.ndjson');
    expect(file.window).toBe('72h');
    expect(file.clamped).toBe(true);
  });

  it('throws the problem rather than saving an error body as the file', async () => {
    const response = new Response(
      JSON.stringify({ status: 402, code: 'plan_feature_gated', title: 'Upgrade' }),
      { status: 402, headers: { 'Content-Type': 'application/problem+json' } }
    );
    get.mockResolvedValue({
      error: { status: 402, code: 'plan_feature_gated', title: 'Upgrade' },
      response,
    });
    await expect(exportDebugRequests('api', { since: '24h', format: 'csv' })).rejects.toMatchObject(
      { code: 'plan_feature_gated' }
    );
  });
});
