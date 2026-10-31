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

it('lists log drains as a paid Beta capability, as the faas catalog does', () => {
  const pro = mockCapabilities('pro', []).capabilities.find((item) => item.key === 'log-drains');
  const free = mockCapabilities('free', []).capabilities.find((item) => item.key === 'log-drains');
  expect(pro).toMatchObject({ maturity: 'beta', enabled: true, docs_url: '/docs/logs#log-drains' });
  expect(free).toMatchObject({ enabled: false, unavailable_reason: 'plan_not_entitled' });
});
