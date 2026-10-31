import { expect, it } from 'vitest';
import { mockCapabilities } from './capabilities';

it('lists response caching as a paid Preview capability in mock registry data', () => {
  const paid = mockCapabilities('hobby', []).capabilities.find(
    (item) => item.key === 'declarative-response-caching'
  );
  const free = mockCapabilities('free', []).capabilities.find(
    (item) => item.key === 'declarative-response-caching'
  );
  expect(paid).toMatchObject({ maturity: 'preview', enabled: true });
  expect(free).toMatchObject({ enabled: false, unavailable_reason: 'plan_not_entitled' });
});
