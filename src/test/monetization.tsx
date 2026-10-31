import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { ConfirmProvider } from '@/components/ui/confirm';
import { ToastProvider } from '@/components/ui/toast';
import { spyApi } from './api';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Init = {
  params?: { path?: Record<string, string>; query?: Record<string, unknown> };
  body?: unknown;
};

/** A handler's answer: data for a 2xx, or `problem(...)` for an RFC 7807 failure. */
export type Answer = unknown | { __problem: { status: number; code: string; detail?: string } };
export type Handlers = Partial<Record<`${Method} ${string}`, (init: Init) => Answer>>;

export function problem(status: number, code: string, detail?: string) {
  return { __problem: { status, code, detail } };
}

/**
 * Answers the typed client by spec path (`'GET /v1/apps/{slug}/consumers'`),
 * through `spyApi` so the generic over every path is never instantiated.
 * Returns the spies so a test can assert on the calls.
 */
export function routeApi(handlers: Handlers, status: Partial<Record<string, number>> = {}) {
  const spies = {} as Record<Method, ReturnType<typeof spyApi>>;
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    spies[method] = spyApi(method).mockImplementation(async (path, init) => {
      const handler = handlers[`${method} ${path}`];
      if (!handler) throw new Error(`unrouted ${method} ${path}`);
      const answer = handler((init ?? {}) as Init);
      if (answer && typeof answer === 'object' && '__problem' in answer) {
        const p = (answer as { __problem: { status: number; code: string; detail?: string } })
          .__problem;
        return {
          error: { ...p, title: p.code },
          response: new Response(null, { status: p.status }),
        };
      }
      return {
        data: answer,
        response: new Response(null, { status: status[`${method} ${path}`] ?? 200 }),
      };
    });
  }
  return spies;
}

/** The providers a monetization page needs, with a client that never retries. */
export function renderWithProviders(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <ConfirmProvider>{ui}</ConfirmProvider>
        </ToastProvider>
      </QueryClientProvider>
    ),
  };
}

/** Stand-in for `useCapability('api-monetization')`; set `.state` per test. */
const ACCESS: Record<string, string> = { available: 'on', unknown: 'off' };
/** One mocked capability for both `useCapability` (view state) and `useCapabilityAccess`. */
export const capability = {
  accountId: 'acct-1',
  state: 'available' as string,
  capability: undefined as unknown,
  refresh: vi.fn(),
  get access() {
    return ACCESS[this.state] ?? this.state;
  },
};
