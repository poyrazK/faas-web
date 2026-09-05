import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { retryPolicy } from '@/lib/api/retry';

/**
 * Query infrastructure belongs to API-backed routes, not the public shell.
 * Keeping this module out of the root route prevents anonymous marketing and
 * documentation visits from loading the console's query graph.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: retryPolicy,
    },
    mutations: { retry: false },
  },
});

export function AppQueryProvider({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
