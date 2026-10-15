import { expect, it } from 'vitest';
import { mockOpenAPIPreview } from './openapi-preview';

it('classifies declaration and fixture observations with enabled policy coverage only', () => {
  const result = mockOpenAPIPreview(
    'app-1',
    { openapi: '3.1.0', paths: { '/orders': { get: {} }, '/declared': { post: {} } } },
    ['/orders', '/observed'],
    [
      {
        id: 'disabled',
        match_path: '/*',
        match_host: '*',
        match_methods: [],
        priority: 1,
        enabled: false,
        kind: 'deny',
        action: {},
      },
    ] as never
  );
  expect(result.routes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: '/orders',
        method: 'get',
        status: 'matched',
        covered: false,
      }),
      expect.objectContaining({ path: '/declared', status: 'declared_only' }),
      expect.objectContaining({ path: '/observed', status: 'observed_only' }),
    ])
  );
  expect(result.observed_source).toBe('live');
});
