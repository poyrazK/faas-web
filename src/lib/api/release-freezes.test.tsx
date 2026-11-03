import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import {
  freezeCoverage,
  liftOwner,
  minutesLabel,
  ownerCoverage,
  reasonProblem,
  useCreateReleaseFreeze,
  useLiftReleaseFreeze,
  useReleaseFreezes,
  validTimeZone,
  weeklyLabel,
} from './release-freezes';

const ok = (data: unknown) => ({ data, response: new Response(null, { status: 200 }) }) as never;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

afterEach(() => vi.restoreAllMocks());

describe('freeze wording', () => {
  it('names what a freeze covers: one app, an organization’s apps, or the account’s personal apps', () => {
    expect(freezeCoverage({ app: 'shop' })).toBe('shop');
    expect(freezeCoverage({ org: 'acme' })).toBe('every app of acme');
    expect(freezeCoverage({})).toBe('every personal app of your account');
    expect(ownerCoverage({ kind: 'org', org: 'acme' })).toMatch(
      /every app of the organization acme, whoever created it/
    );
    expect(ownerCoverage({ kind: 'account' })).toMatch(/company apps keep their organization’s/);
  });

  it('reads durations and weekly windows the way the CLI writes them', () => {
    expect(minutesLabel(45)).toBe('45 min');
    expect(minutesLabel(120)).toBe('2 h');
    expect(minutesLabel(90)).toBe('1 h 30 min');
    expect(minutesLabel(3840)).toBe('2 d 16 h');
    expect(minutesLabel(10080)).toBe('7 d');
    expect(
      weeklyLabel({
        days: ['fri'],
        start: '16:00',
        duration_minutes: 3840,
        time_zone: 'Europe/Istanbul',
      })
    ).toBe('Every Fri at 16:00 for 2 d 16 h, Europe/Istanbul time');
  });

  it('checks a reason and a time zone as apid does', () => {
    expect(reasonProblem('  ')).toBeDefined();
    expect(reasonProblem('x'.repeat(201))).toMatch(/200/);
    expect(reasonProblem('holiday freeze')).toBeUndefined();
    expect(validTimeZone('Europe/Istanbul')).toBe(true);
    expect(validTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('freeze routes', () => {
  it('reads an app’s, the account’s and an organization’s freezes from their own routes', async () => {
    const get = spyApi('GET').mockResolvedValue(ok({ freezes: [] }));
    for (const owner of [
      { kind: 'app', slug: 'shop' },
      { kind: 'account' },
      { kind: 'org', org: 'acme' },
    ] as const) {
      const { result } = renderHook(() => useReleaseFreezes(owner), { wrapper });
      await waitFor(() => expect(result.current.data).toEqual([]));
    }
    expect(get.mock.calls.map((c) => c[0])).toEqual([
      '/v1/apps/{slug}/freezes',
      '/v1/freezes',
      '/v1/orgs/{slug}/freezes',
    ]);
  });

  it('creates through the owner’s route', async () => {
    const post = spyApi('POST').mockResolvedValue(ok({ id: 'f' }));
    const { result } = renderHook(() => useCreateReleaseFreeze(), { wrapper });
    const body = { kind: 'window' as const, reason: 'holiday freeze' };
    await act(() => result.current.mutateAsync({ owner: { kind: 'org', org: 'acme' }, body }));
    await act(() => result.current.mutateAsync({ owner: { kind: 'account' }, body }));
    expect(post).toHaveBeenNthCalledWith(
      1,
      '/v1/orgs/{slug}/freezes',
      expect.objectContaining({ params: { path: { slug: 'acme' } }, body })
    );
    expect(post).toHaveBeenNthCalledWith(2, '/v1/freezes', expect.objectContaining({ body }));
  });

  it('lifts a freeze on one app through the app, and one on all apps through its owner', async () => {
    expect(liftOwner({ app: 'shop', org: 'acme' })).toEqual({ kind: 'app', slug: 'shop' });
    const del = spyApi('DELETE').mockResolvedValue(ok({ id: 'f' }));
    const { result } = renderHook(() => useLiftReleaseFreeze(), { wrapper });
    await act(() => result.current.mutateAsync({ id: 'f1', app: 'shop' }));
    await act(() => result.current.mutateAsync({ id: 'f2', org: 'acme' }));
    await act(() => result.current.mutateAsync({ id: 'f3' }));
    expect(del.mock.calls.map((c) => [c[0], (c[1] as { params: unknown }).params])).toEqual([
      ['/v1/apps/{slug}/freezes/{id}', { path: { slug: 'shop', id: 'f1' } }],
      ['/v1/orgs/{slug}/freezes/{id}', { path: { slug: 'acme', id: 'f2' } }],
      ['/v1/freezes/{id}', { path: { id: 'f3' } }],
    ]);
  });
});
