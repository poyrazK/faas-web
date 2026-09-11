import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/lib/api/client';
import { Route as Invoices } from './dashboard.invoices';

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const invoice = {
  id: 'invoice-1',
  number: 'INV-001',
  provider_invoice_id: 'provider-1',
  status: 'paid',
  period_start: '2026-08-01T00:00:00Z',
  period_end: '2026-08-31T23:59:59Z',
  total_cents: 900,
  currency: 'eur',
  created_at: '2026-09-01T00:00:00Z',
};
const olderInvoice = { ...invoice, id: 'invoice-2', number: 'INV-002' };
let reads: string[];

async function mount() {
  const root = createRootRoute({ component: Outlet });
  const dashboard = createRoute({
    getParentRoute: () => root,
    path: 'dashboard',
    component: Outlet,
  });
  const route = createRoute({
    getParentRoute: () => dashboard,
    path: 'invoices',
    component: Invoices.options.component,
  });
  const router = createRouter({
    routeTree: root.addChildren([dashboard.addChildren([route])]),
    history: createMemoryHistory({ initialEntries: ['/dashboard/invoices'] }),
  });
  await router.load();
  await act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    );
  });
}

beforeEach(() => {
  reads = [];
  vi.spyOn(api, 'GET').mockImplementation(async (path, options) => {
    const query = (options as { params?: { query?: { before?: string; limit?: number } } })?.params
      ?.query;
    reads.push(`${path}:${JSON.stringify(query ?? {})}`);
    if (path === '/v1/invoices') {
      return {
        data: query?.before
          ? { items: [olderInvoice], next_before: null }
          : { items: [invoice], next_before: 'invoice-cursor-1' },
        response: new Response(),
      } as never;
    }
    throw new Error(`Unexpected GET ${path}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('loads older invoices without losing the current page', async () => {
  await mount();
  expect(await screen.findByText('INV-001')).toBeInTheDocument();

  await userEvent.click(await screen.findByRole('button', { name: 'Load older invoices' }));
  expect(await screen.findByText('INV-002')).toBeInTheDocument();
  expect(reads).toContain('/v1/invoices:{"limit":50,"before":"invoice-cursor-1"}');
});
