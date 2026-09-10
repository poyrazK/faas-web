import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

let useDataHook: typeof import('./store').useData;

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : 'url' in input ? input.url : input.toString();
  return new URL(raw, 'http://localhost').pathname;
}

function Probe() {
  const data = useDataHook();
  const quiet = data.getWorkflow('quiet-app');
  return (
    <>
      <span data-testid="loading">{String(data.loading)}</span>
      <span data-testid="workflow-count">{data.workflows.length}</span>
      <span data-testid="quiet-app-state">{quiet?.state ?? 'missing'}</span>
      <span data-testid="quiet-app-version">{quiet?.version ?? 'missing'}</span>
      <span data-testid="error">{data.error?.message ?? 'none'}</span>
    </>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('DataProvider latest deployment metadata', () => {
  it('uses one batch request and keeps undeployed projection hidden while it is pending', async () => {
    const apps = Array.from({ length: 100 }, (_, index) => ({
      id: `app-${index}`,
      slug: index === 99 ? 'quiet-app' : `busy-app-${index}`,
      type: 'function',
      runtime: 'node22',
      ram_mb: 256,
      max_concurrency: 2,
      concurrency_per_vm: 5,
      min_instances: 0,
      status: 'active',
      url: `https://app-${index}.example.com`,
      manifest: {},
      autoscale_target_rps: 0,
      autoscale_target_cpu_pct: 0,
    }));
    const quietDeployment = {
      id: 'deployment-quiet',
      app_id: 'app-99',
      image_digest: 'sha256:abc1234fedcba',
      kind: 'image',
      status: 'live',
      created_at: '2026-09-10T12:00:00Z',
    };

    let resolveBatch!: (response: Response) => void;
    const pendingBatch = new Promise<Response>((resolve) => {
      resolveBatch = resolve;
    });
    const pendingAppRequest = new Promise<Response>(() => {});
    const NativeRequest = Request;
    class BrowserRequest extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(
          typeof input === 'string' && input.startsWith('/') ? `http://localhost${input}` : input,
          init
        );
      }
    }
    vi.stubGlobal('Request', BrowserRequest);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = requestPath(input);
      if (path === '/v1/apps') return Promise.resolve(json(apps));
      if (path === '/v1/apps/metrics') {
        return Promise.resolve(
          json({ range: '24h', source: 'prometheus', as_of: '2026-09-10T12:00:00Z', apps: {} })
        );
      }
      if (path === '/v1/deployments/latest-by-app') return pendingBatch;
      if (path === '/v1/deployments') return Promise.resolve(json({ items: [] }));
      if (/^\/v1\/apps\/[^/]+\/deployments$/.test(path)) return pendingAppRequest;
      return Promise.reject(new Error(`unexpected request: ${path}`));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { DataProvider, useData } = await import('./store');
    useDataHook = useData;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <DataProvider>
          <Probe />
        </DataProvider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('workflow-count')).toHaveTextContent('100'));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const latestMetadataRequests = fetchMock.mock.calls.filter(([input]) => {
      const path = requestPath(input);
      return (
        path === '/v1/deployments/latest-by-app' || /^\/v1\/apps\/[^/]+\/deployments$/.test(path)
      );
    });
    expect(latestMetadataRequests).toHaveLength(1);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    await act(async () => {
      resolveBatch(json({ items: [quietDeployment] }));
    });

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('quiet-app-state')).toHaveTextContent('running');
    expect(screen.getByTestId('quiet-app-version')).toHaveTextContent('abc1234');
  });
});
