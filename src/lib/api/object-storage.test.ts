import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBucketBinding,
  revokeBucketBinding,
  rotateBucketBinding,
  uploadSignedObject,
} from './object-storage';
import { spyApi } from '@/test/api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('direct object uploads', () => {
  it('omits Gregale credentials and lets the browser supply the signed length', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['abc'], 'file.txt');
    await uploadSignedObject(
      {
        url: 'https://objects.example.test/signed',
        method: 'PUT',
        headers: { 'Content-Length': '3', 'Content-Type': 'text/plain' },
        expires_at: '2026-09-05T12:00:00Z',
      },
      file
    );
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://objects.example.test/signed');
    expect(options).toMatchObject({
      method: 'PUT',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      body: file,
    });
    expect(options.headers.has('Content-Length')).toBe(false);
    expect(options.headers.has('Authorization')).toBe(false);
    expect(options.headers.get('Content-Type')).toBe('text/plain');
  });

  it('preserves the empty-upload integrity header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await uploadSignedObject(
      {
        url: 'https://objects.example.test/signed',
        method: 'PUT',
        headers: { 'Content-Md5': '1B2M2Y8AsgTpgAmY7PhCfg==' },
        expires_at: '2026-09-05T12:00:00Z',
      },
      new File([], 'empty')
    );
    expect(fetchMock.mock.calls[0][1].headers.get('Content-Md5')).toBe('1B2M2Y8AsgTpgAmY7PhCfg==');
  });

  it('reports failure without exposing upstream diagnostics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('secret provider detail', { status: 403 }))
    );
    await expect(
      uploadSignedObject(
        {
          url: 'https://objects.example.test/signed',
          method: 'PUT',
          headers: {},
          expires_at: '2026-09-05T12:00:00Z',
        },
        new File(['abc'], 'file')
      )
    ).rejects.toThrow('Upload failed (403)');
  });
});

describe('compute bindings, versioning and lifecycle', () => {
  const ok = (data: unknown) => ({ data, response: new Response() }) as never;

  it('binds a bucket to its app with the chosen permission, sending a prefix only when one is set', async () => {
    const post = spyApi('POST').mockResolvedValue(ok({ id: 'b1' }));
    await createBucketBinding('shop', 'bkt', { permission: 'read' });
    expect(post).toHaveBeenLastCalledWith('/v1/apps/{slug}/buckets/{bucket}/compute-bindings', {
      params: { path: { slug: 'shop', bucket: 'bkt' } },
      body: { permission: 'read' },
    });
    await createBucketBinding('shop', 'bkt', { permission: 'read_write', prefix: 'MEDIA' });
    expect(post).toHaveBeenLastCalledWith('/v1/apps/{slug}/buckets/{bucket}/compute-bindings', {
      params: { path: { slug: 'shop', bucket: 'bkt' } },
      body: { permission: 'read_write', prefix: 'MEDIA' },
    });
  });

  it('rotates and revokes a binding by its id', async () => {
    const post = spyApi('POST').mockResolvedValue(ok({ id: 'b1' }));
    const del = spyApi('DELETE').mockResolvedValue(ok(undefined));
    await rotateBucketBinding('shop', 'bkt', 'b1');
    expect(post).toHaveBeenLastCalledWith(
      '/v1/apps/{slug}/buckets/{bucket}/compute-bindings/{binding}/rotate',
      { params: { path: { slug: 'shop', bucket: 'bkt', binding: 'b1' } } }
    );
    await revokeBucketBinding('shop', 'bkt', 'b1');
    expect(del).toHaveBeenLastCalledWith(
      '/v1/apps/{slug}/buckets/{bucket}/compute-bindings/{binding}',
      { params: { path: { slug: 'shop', bucket: 'bkt', binding: 'b1' } } }
    );
  });
});
