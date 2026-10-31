import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { expect, it } from 'vitest';
import { useFreshRestart } from './queries';
import { spyApi } from '@/test/api';

// A plain restart captures process memory and would keep the old environment;
// only fresh=true replaces instances from a clean boot (apid restartApp).
it('restarts with fresh=true so new secrets and bindings apply', async () => {
  const post = spyApi('POST').mockResolvedValue({ data: {}, response: new Response() } as never);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useFreshRestart('shop'), { wrapper });
  await result.current.mutateAsync();
  expect(post).toHaveBeenCalledWith('/v1/apps/{slug}/restart', {
    params: { path: { slug: 'shop' }, query: { fresh: true } },
  });
});
