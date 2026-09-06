import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadSignedObject } from './object-storage';

afterEach(() => vi.unstubAllGlobals());

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
