import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import {
  reviewBlocker,
  reviewedDeployBody,
  reviewedRollout,
  useReviewSource,
  type SourceReview,
} from './source-review';

const ok = (data: unknown, status = 200) =>
  ({ data, response: new Response(null, { status }) }) as never;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

afterEach(() => vi.restoreAllMocks());

const review = (over: Partial<SourceReview['release_review']> = {}): SourceReview => ({
  app_id: 'app-a',
  repo: 'acme-corp/webhook-router',
  commit_sha: 'a'.repeat(40),
  installation_id: 48213377,
  repository_id: 1003,
  source_root: '',
  release_review: {
    app_id: 'app-a',
    scope: 'default',
    configuration_hash: 'c'.repeat(64),
    latest_deployment_id: 'dep-1',
    serving_deployment_ids: ['dep-1'],
    ...over,
  },
});

describe('source review', () => {
  it('resolves the repository and ref without building anything', async () => {
    const post = spyApi('POST').mockResolvedValue(ok(review()));
    const hook = renderHook(() => useReviewSource('alpha'), { wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync({ repo: 'acme-corp/webhook-router', ref: 'main' });
    });
    expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/source-review', {
      params: { path: { slug: 'alpha' } },
      body: { repo: 'acme-corp/webhook-router', ref: 'main' },
    });
  });

  it('chooses the reviewed release the workload mode allows', () => {
    expect(reviewedRollout(undefined)).toBe('stage');
    expect(reviewedRollout('request')).toBe('stage');
    expect(reviewedRollout('service')).toBe('service');
    expect(reviewedRollout('worker')).toBe('worker');
    expect(reviewedRollout('job')).toBeNull();
  });

  it('stages exactly the reviewed commit at 0% with the review as its pin', () => {
    const pinned = review();
    expect(reviewedDeployBody(pinned, 'stage')).toEqual({
      repo: 'acme-corp/webhook-router',
      ref: 'a'.repeat(40),
      format: 'tarball',
      no_triggers: true,
      traffic_percent: 0,
      expected_source: pinned,
    });
  });

  it('hands a service or worker over natively, with traffic left to the rollout', () => {
    const body = reviewedDeployBody(review(), 'worker');
    expect(body).toMatchObject({ native_rollout: 'worker', no_triggers: true });
    expect(body).not.toHaveProperty('traffic_percent');
  });

  it('names what the API would refuse before anything is sent', () => {
    expect(reviewBlocker(review(), 'stage')).toBeNull();
    expect(reviewBlocker(review({ serving_deployment_ids: ['a', 'b'] }), 'stage')).toMatch(
      /split across 2 releases/i
    );
    expect(reviewBlocker(review({ protected: true }), 'service')).toMatch(/protected/i);
    expect(reviewBlocker(review({ protected: true }), 'stage')).toBeNull();
  });
});
