import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './client';
import { openAPIPreviewKey } from './openapi-preview';
import {
  useImportAppOpenAPI,
  useDeleteAppOpenAPI,
  useCreateEdgeRule,
  useUpdateEdgeRule,
  useDeleteEdgeRule,
} from './queries';

afterEach(() => vi.restoreAllMocks());
it.each(['import', 'delete', 'create-rule', 'update-rule', 'delete-rule'])(
  'invalidates observed preview after %s changes its inputs',
  async (operation) => {
    vi.spyOn(api, 'POST').mockResolvedValue({ data: {}, response: new Response() } as never);
    vi.spyOn(api, 'PATCH').mockResolvedValue({ data: {}, response: new Response() } as never);
    vi.spyOn(api, 'DELETE').mockResolvedValue({
      response: new Response(null, { status: 204 }),
    } as never);
    const client = new QueryClient();
    const key = openAPIPreviewKey('account-1', 'app-a');
    client.setQueryData(key, { app_id: 'app-1', routes: [] });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(
      () => ({
        upload: useImportAppOpenAPI('app-a'),
        remove: useDeleteAppOpenAPI('app-a'),
        create: useCreateEdgeRule(),
        update: useUpdateEdgeRule(),
        deleteRule: useDeleteEdgeRule(),
      }),
      { wrapper }
    );
    await act(async () => {
      if (operation === 'import')
        await hook.result.current.upload.mutateAsync({ openapi: '3.1.0', info: {}, paths: {} });
      else if (operation === 'delete') await hook.result.current.remove.mutateAsync();
      else if (operation === 'create-rule')
        await hook.result.current.create.mutateAsync({
          slug: 'app-a',
          match_host: '*',
          match_path: '/',
          match_methods: [],
          priority: 1,
          enabled: true,
          kind: 'deny',
          action: {},
        } as never);
      else if (operation === 'update-rule')
        await hook.result.current.update.mutateAsync({ id: 'rule-1', enabled: false });
      else await hook.result.current.deleteRule.mutateAsync('rule-1');
    });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  }
);
