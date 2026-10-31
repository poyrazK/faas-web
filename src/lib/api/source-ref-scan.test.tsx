import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { spyApi } from '@/test/api';
import { ApiError } from './errors';
import { useSourceRefScan, type ProjectPlan } from './queries';

const plan = (name: string): ProjectPlan => ({
  project_slug: 'demo',
  scan_source: 'single',
  tier: 'hobby',
  workloads: [{ name, root_dir: '', command: [], ports: [8080] }],
  managed: [],
  crons: [],
  observed_apps: 0,
  observed_crons: 0,
  limit_apps: 10,
  limit_crons: 10,
  can_apply: true,
  plan_token: 'token',
});

type Input = Parameters<typeof useSourceRefScan>[0];
const input = (ref: string, overrides: Partial<Input> = {}): Input => ({
  repo: 'acme/demo',
  ref,
  installId: 42,
  projectSlug: 'demo',
  enabled: true,
  ...overrides,
});

function mount(initial: Input) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook((props: Input) => useSourceRefScan(props), { initialProps: initial, wrapper });
}

afterEach(() => vi.restoreAllMocks());

it('scans once the repository and ref hold still, with the scan request body', async () => {
  const post = spyApi('POST').mockResolvedValue({ data: plan('api'), response: new Response() });
  const view = mount(input('', { enabled: false }));
  for (const ref of ['m', 'ma', 'mai', 'main']) view.rerender(input(ref));
  expect(view.result.current.scanning).toBe(true);
  expect(post).not.toHaveBeenCalled();
  await waitFor(() => expect(view.result.current.plan?.workloads[0].name).toBe('api'));
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith('/v1/projects/scan/source-ref', {
    body: { repo: 'acme/demo', ref: 'main', project_slug: 'demo', install_id: 42 },
    signal: expect.any(AbortSignal),
  });
});

it('answers a pair it already scanned from cache', async () => {
  const post = spyApi('POST').mockImplementation((_path, init) =>
    Promise.resolve({
      data: plan((init as { body: { ref: string } }).body.ref),
      response: new Response(),
    })
  );
  const view = mount(input('main'));
  await waitFor(() => expect(view.result.current.plan?.workloads[0].name).toBe('main'));
  view.rerender(input('develop'));
  await waitFor(() => expect(view.result.current.plan?.workloads[0].name).toBe('develop'));
  view.rerender(input('main'));
  expect(view.result.current.plan?.workloads[0].name).toBe('main');
  expect(view.result.current.scanning).toBe(false);
  expect(post).toHaveBeenCalledTimes(2);
});

it('aborts a scan the user has moved away from', async () => {
  const signals: AbortSignal[] = [];
  spyApi('POST').mockImplementation((_path, init) => {
    signals.push((init as { signal: AbortSignal }).signal);
    return new Promise(() => {});
  });
  const view = mount(input('main'));
  await waitFor(() => expect(signals).toHaveLength(1));
  view.rerender(input('develop'));
  await waitFor(() => expect(signals[0].aborted).toBe(true));
});

it('reports a failed scan without retrying it', async () => {
  const post = spyApi('POST').mockResolvedValue({
    error: { status: 503, code: 'capacity_unavailable', title: 'No headroom' },
    response: new Response(null, { status: 503 }),
  });
  const view = mount(input('main'));
  await waitFor(() => expect(view.result.current.error).toBeInstanceOf(ApiError));
  expect((view.result.current.error as ApiError).code).toBe('capacity_unavailable');
  expect(view.result.current.scanning).toBe(false);
  expect(post).toHaveBeenCalledTimes(1);
});

it('does not scan while disabled', async () => {
  const post = spyApi('POST');
  const view = mount(input('main', { enabled: false }));
  await new Promise((resolve) => setTimeout(resolve, 700));
  expect(post).not.toHaveBeenCalled();
  expect(view.result.current).toEqual({ plan: undefined, error: null, scanning: false });
});
