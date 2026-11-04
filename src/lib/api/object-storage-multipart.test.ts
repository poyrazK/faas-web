import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { uploadMultipartObject } from './object-storage';

const calls = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));
vi.mock('./client', async (original) => ({
  ...(await original<typeof import('./client')>()),
  api: { GET: calls.get, POST: calls.post },
}));

const ok = (data: unknown) =>
  Promise.resolve({ data, response: new Response(null, { status: 200 }) });
const session = {
  id: 'f1e2d3c4-b5a6-4978-8a7b-6c5d4e3f2a04',
  key: 'video.mp4',
  size_bytes: 10,
  part_size_bytes: 4,
  part_count: 3,
  content_type: 'video/mp4',
  state: 'active',
  expires_at: '2026-11-04T00:00:00Z',
  created_at: '2026-11-03T00:00:00Z',
};
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(new Response(null, { status: 200, headers: { ETag: '"x"' } }));
});
afterEach(() => vi.unstubAllGlobals());

it('skips parts storage already confirmed, then completes with the confirmed ETags in order', async () => {
  const confirmed = [{ part_number: 2, etag: '"b"', size_bytes: 4, last_modified: '' }];
  const all = [
    { part_number: 3, etag: '"c"', size_bytes: 2, last_modified: '' },
    { part_number: 1, etag: '"a"', size_bytes: 4, last_modified: '' },
    ...confirmed,
  ];
  calls.get.mockReturnValueOnce(ok({ items: confirmed })).mockReturnValueOnce(ok({ items: all }));
  calls.post.mockImplementation((path: string, init: { params: { path: { part?: number } } }) => {
    if (path.endsWith('/multipart-uploads')) return ok(session);
    if (path.endsWith('/signed-url'))
      return ok({
        url: `https://s3.gregale.dev/part-${init.params.path.part}`,
        method: 'PUT',
        headers: {},
        expires_at: '',
      });
    return ok({ ...session, state: 'completed' });
  });
  const progress = vi.fn();
  const file = new Blob(['0123456789'], { type: 'video/mp4' });
  await uploadMultipartObject('demo', 'bucket-one', file, 'video.mp4', { onProgress: progress });

  expect(calls.post).toHaveBeenCalledWith(
    '/v1/apps/{slug}/buckets/{bucket}/multipart-uploads',
    expect.objectContaining({
      body: { key: 'video.mp4', size_bytes: 10, content_type: 'video/mp4' },
    })
  );
  // Part 2 was confirmed already: only parts 1 and 3 go to the storage host.
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    'https://s3.gregale.dev/part-1',
    'https://s3.gregale.dev/part-3',
  ]);
  expect((fetchMock.mock.calls[1][1] as RequestInit).body).toEqual(file.slice(8, 12));
  expect(progress).toHaveBeenLastCalledWith({ upload: session.id, part: 3, parts: 3 });
  expect(calls.post).toHaveBeenLastCalledWith(
    '/v1/apps/{slug}/buckets/{bucket}/multipart-uploads/{upload}/complete',
    expect.objectContaining({
      body: {
        parts: [
          { part_number: 1, etag: '"a"' },
          { part_number: 2, etag: '"b"' },
          { part_number: 3, etag: '"c"' },
        ],
      },
    })
  );
});

it('does not complete when storage has not confirmed every part', async () => {
  calls.get.mockReturnValue(ok({ items: [] }));
  calls.post.mockImplementation((path: string) =>
    path.endsWith('/multipart-uploads')
      ? ok(session)
      : ok({ url: 'https://s3.gregale.dev/p', method: 'PUT', headers: {}, expires_at: '' })
  );
  await expect(
    uploadMultipartObject('demo', 'bucket-one', new Blob(['0123456789']), 'video.mp4')
  ).rejects.toThrow(/confirmed 0 of 3 parts/);
  expect(calls.post).not.toHaveBeenCalledWith(
    '/v1/apps/{slug}/buckets/{bucket}/multipart-uploads/{upload}/complete',
    expect.anything()
  );
});
