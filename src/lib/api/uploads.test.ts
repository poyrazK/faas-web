import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { uploadTarball } from './uploads';

type Init = {
  params?: { path?: Record<string, string>; header?: Record<string, string | number> };
  body?: unknown;
  headers?: Record<string, string>;
};
type Call = { method: string; path: string; init: Init };

const ok = (data: unknown, status = 200) => ({ data, response: new Response(null, { status }) });
const refused = (status: number, code: string) => ({
  error: { code, title: code, status },
  response: new Response(JSON.stringify({ code, title: code, status }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  }),
});

/** A scripted API through the client's methods; `script` may throw to drop a reply. */
function server(script: (call: Call) => unknown) {
  const calls: Call[] = [];
  for (const method of ['GET', 'POST', 'PATCH'] as const)
    spyApi(method).mockImplementation(async (path: string, init?: unknown) => {
      const call = { method, path, init: (init ?? {}) as Init };
      calls.push(call);
      return script(call);
    });
  return calls;
}
const offset = (c: Call) => String(c.init.params?.header?.['Upload-Offset']);
const size = (c: Call) => (c.init.body as Blob).size;

afterEach(() => vi.restoreAllMocks());

describe('uploadTarball', () => {
  it('opens a session, sends chunks at the server chunk size, and commits with an attempt id', async () => {
    const calls = server((c) => {
      if (c.method === 'POST' && c.path === '/v1/uploads')
        return ok({ upload_id: 'u1', chunk_size: 4, total_size: 10, expires_at: '' }, 201);
      if (c.method === 'PATCH') return ok(undefined);
      if (c.path === '/v1/uploads/{id}/commit') return ok({ id: 'dep-1' }, 201);
      throw new Error(`unexpected ${c.method} ${c.path}`);
    });
    const progress: number[] = [];
    const dep = await uploadTarball({
      slug: 'alpha',
      file: new Blob(['0123456789']),
      onProgress: (sent) => progress.push(sent),
    });
    expect(dep.id).toBe('dep-1');
    expect(calls[0].init.body).toMatchObject({ app_slug: 'alpha', total_size: 10 });
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches.map((c) => [offset(c), size(c)])).toEqual([
      ['0', 4],
      ['4', 4],
      ['8', 2],
    ]);
    expect(patches[0].init.headers?.['Content-Type']).toBe('application/offset+octet-stream');
    expect(progress).toEqual([4, 8, 10]);
    const commit = calls.at(-1)!;
    expect(String(commit.init.params?.header?.['Deployment-Attempt-ID'])).toMatch(/^[0-9a-f]{32}$/);
  });

  it('resumes from the server offset after a 409 instead of restarting', async () => {
    let patched = 0;
    const calls = server((c) => {
      if (c.method === 'POST' && c.path === '/v1/uploads')
        return ok({ upload_id: 'u2', chunk_size: 5, total_size: 10, expires_at: '' }, 201);
      if (c.method === 'PATCH') {
        patched += 1;
        return patched === 2 ? refused(409, 'upload_session_offset_conflict') : ok(undefined);
      }
      if (c.method === 'GET') return ok({ upload_id: 'u2', received_bytes: 5, chunk_size: 5 });
      if (c.path === '/v1/uploads/{id}/commit') return ok({ id: 'dep-2' }, 201);
      throw new Error(`unexpected ${c.method} ${c.path}`);
    });
    await uploadTarball({ slug: 'alpha', file: new Blob(['abcdefghij']) });
    expect(calls.filter((c) => c.method === 'PATCH').map(offset)).toEqual(['0', '5', '5']);
  });

  it('recovers a lost commit reply with the same attempt id', async () => {
    let commits = 0;
    const calls = server((c) => {
      if (c.method === 'POST' && c.path === '/v1/uploads')
        return ok({ upload_id: 'u3', chunk_size: 10, total_size: 3, expires_at: '' }, 201);
      if (c.method === 'PATCH') return ok(undefined);
      if (c.path === '/v1/uploads/{id}/commit') {
        commits += 1;
        if (commits === 1) throw new TypeError('Failed to fetch');
        return ok({ id: 'dep-3' }, 202);
      }
      throw new Error(`unexpected ${c.method} ${c.path}`);
    });
    const dep = await uploadTarball({ slug: 'alpha', file: new Blob(['abc']) });
    expect(dep.id).toBe('dep-3');
    const ids = calls
      .filter((c) => c.path === '/v1/uploads/{id}/commit')
      .map((c) => c.init.params?.header?.['Deployment-Attempt-ID']);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('does not retry a commit the API refused', async () => {
    const calls = server((c) => {
      if (c.method === 'POST' && c.path === '/v1/uploads')
        return ok({ upload_id: 'u4', chunk_size: 10, total_size: 3, expires_at: '' }, 201);
      if (c.method === 'PATCH') return ok(undefined);
      return refused(409, 'application_standards_pending');
    });
    await expect(uploadTarball({ slug: 'alpha', file: new Blob(['abc']) })).rejects.toMatchObject({
      code: 'application_standards_pending',
    });
    expect(calls.filter((c) => c.path === '/v1/uploads/{id}/commit')).toHaveLength(1);
  });
});

describe('uploadTarball when a chunk does not land', () => {
  it('resumes from the server offset after the connection drops mid-chunk', async () => {
    let patched = 0;
    const calls = server((c) => {
      if (c.method === 'POST' && c.path === '/v1/uploads')
        return ok({ upload_id: 'u5', chunk_size: 5, total_size: 10, expires_at: '' }, 201);
      if (c.method === 'PATCH') {
        patched += 1;
        if (patched === 2) throw new TypeError('Failed to fetch');
        return ok(undefined);
      }
      if (c.method === 'GET') return ok({ upload_id: 'u5', received_bytes: 5, chunk_size: 5 });
      if (c.path === '/v1/uploads/{id}/commit') return ok({ id: 'dep-5' }, 201);
      throw new Error(`unexpected ${c.method} ${c.path}`);
    });
    const dep = await uploadTarball({ slug: 'alpha', file: new Blob(['abcdefghij']) });
    expect(dep.id).toBe('dep-5');
    expect(calls.filter((c) => c.method === 'PATCH').map(offset)).toEqual(['0', '5', '5']);
  });

  it('stops on a cancelled session instead of re-sending forever', async () => {
    // apid answers 409 upload_session_already_cancelled; re-reading would
    // return the same offset and loop (faas handlers_upload_session.go).
    const calls = server((c) => {
      if (c.method === 'POST' && c.path === '/v1/uploads')
        return ok({ upload_id: 'u6', chunk_size: 5, total_size: 10, expires_at: '' }, 201);
      if (c.method === 'PATCH') return refused(409, 'upload_session_already_cancelled');
      if (c.method === 'GET') return ok({ upload_id: 'u6', received_bytes: 0, chunk_size: 5 });
      throw new Error(`unexpected ${c.method} ${c.path}`);
    });
    await expect(
      uploadTarball({ slug: 'alpha', file: new Blob(['abcdefghij']) })
    ).rejects.toMatchObject({
      code: 'upload_session_already_cancelled',
    });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
  });

  it('gives up after a bounded number of resumes when the offset never advances', async () => {
    const calls = server((c) => {
      if (c.method === 'POST' && c.path === '/v1/uploads')
        return ok({ upload_id: 'u7', chunk_size: 5, total_size: 10, expires_at: '' }, 201);
      if (c.method === 'PATCH') return refused(409, 'upload_session_offset_conflict');
      if (c.method === 'GET') return ok({ upload_id: 'u7', received_bytes: 0, chunk_size: 5 });
      throw new Error(`unexpected ${c.method} ${c.path}`);
    });
    await expect(
      uploadTarball({ slug: 'alpha', file: new Blob(['abcdefghij']) })
    ).rejects.toMatchObject({
      code: 'upload_session_offset_conflict',
    });
    expect(calls.filter((c) => c.method === 'PATCH').length).toBeLessThanOrEqual(6);
  });
});
