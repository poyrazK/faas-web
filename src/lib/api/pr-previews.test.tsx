import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './errors';
import {
  PREVIEW_SLUG_MAX,
  previewSlugFor,
  useCreatePreview,
  usePreview,
  validPreviewTtl,
} from './pr-previews';
import { spyApi } from '@/test/api';

const app = { slug: 'pr-42-checkout', preview_of_slug: 'checkout', preview_pr_number: 42 };
const reply = (data: unknown, status = 200) =>
  ({ data, response: new Response(null, { status }) }) as never;
function wrapper(client = new QueryClient()) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}
afterEach(() => vi.restoreAllMocks());

describe('previewSlugFor', () => {
  it('derives the slug the way createPreview does', () => {
    expect(previewSlugFor('checkout', 42)).toBe('pr-42-checkout');
    expect(PREVIEW_SLUG_MAX).toBe(63);
  });
});

describe('validPreviewTtl', () => {
  it('accepts whole hours from 1 to 720', () => {
    expect(validPreviewTtl(1)).toBe(true);
    expect(validPreviewTtl(720)).toBe(true);
    expect(validPreviewTtl(0)).toBe(false);
    expect(validPreviewTtl(721)).toBe(false);
    expect(validPreviewTtl(1.5)).toBe(false);
  });
});

describe('useCreatePreview', () => {
  it('posts the PR number and lease, and reports a new preview', async () => {
    const post = spyApi('POST').mockResolvedValue(reply(app, 201));
    const hook = renderHook(() => useCreatePreview(), { wrapper: wrapper() });
    const result = await hook.result.current.mutateAsync({
      parent: 'checkout',
      prNumber: 42,
      ttlHours: 48,
    });
    expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/previews', {
      params: { path: { slug: 'checkout' } },
      body: { pr_number: 42, ttl_hours: 48 },
    });
    expect(result).toEqual({ app, created: true });
  });

  it('reports a 200 as the existing preview, renewed', async () => {
    spyApi('POST').mockResolvedValue(reply(app, 200));
    const hook = renderHook(() => useCreatePreview(), { wrapper: wrapper() });
    const result = await hook.result.current.mutateAsync({
      parent: 'checkout',
      prNumber: 42,
      ttlHours: 168,
    });
    expect(result.created).toBe(false);
  });

  it('throws the API problem with its code', async () => {
    spyApi('POST').mockResolvedValue({
      error: { status: 403, code: 'plan_limit_apps', title: 'PR preview limit reached' },
      response: new Response(null, { status: 403 }),
    } as never);
    const hook = renderHook(() => useCreatePreview(), { wrapper: wrapper() });
    await expect(
      hook.result.current.mutateAsync({ parent: 'checkout', prNumber: 42, ttlHours: 168 })
    ).rejects.toMatchObject({ code: 'plan_limit_apps' });
  });

  it('refreshes the app list so the new preview is listed', async () => {
    spyApi('POST').mockResolvedValue(reply(app, 201));
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const hook = renderHook(() => useCreatePreview(), { wrapper: wrapper(client) });
    await hook.result.current.mutateAsync({ parent: 'checkout', prNumber: 42, ttlHours: 168 });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['apps'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['preview', 'pr-42-checkout'] });
  });
});

describe('usePreview', () => {
  it('reads one preview by slug', async () => {
    const resource = { app, links: { url: 'https://pr-42-checkout.gregale.dev' } };
    const get = spyApi('GET').mockResolvedValue(reply(resource));
    const hook = renderHook(() => usePreview('pr-42-checkout'), { wrapper: wrapper() });
    await waitFor(() => expect(hook.result.current.data).toEqual(resource));
    expect(get).toHaveBeenCalledWith('/v1/preview/{slug}', {
      params: { path: { slug: 'pr-42-checkout' } },
      signal: expect.any(AbortSignal),
    });
  });

  it('does not retry preview_not_found', async () => {
    const get = spyApi('GET').mockResolvedValue({
      error: { status: 404, code: 'preview_not_found', title: 'Preview not found' },
      response: new Response(null, { status: 404 }),
    } as never);
    const hook = renderHook(() => usePreview('checkout'), { wrapper: wrapper() });
    await waitFor(() => expect(hook.result.current.error).toBeInstanceOf(ApiError));
    expect((hook.result.current.error as ApiError).code).toBe('preview_not_found');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('stays idle without a slug', () => {
    const get = spyApi('GET');
    renderHook(() => usePreview(''), { wrapper: wrapper() });
    expect(get).not.toHaveBeenCalled();
  });
});
