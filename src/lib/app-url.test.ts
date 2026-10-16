import { expect, it } from 'vitest';
import { predictedAppUrl } from './app-url';

it('predicts the URL under the zone an existing app is served from', () => {
  expect(
    predictedAppUrl('new-api', [
      { slug: 'internal-one', url: '' },
      { slug: 'shop', url: 'https://shop.gregale.app' },
    ])
  ).toBe('https://new-api.gregale.app');
});

it('keeps a non-default port and scheme from the learned app', () => {
  expect(predictedAppUrl('new-api', [{ slug: 'shop', url: 'http://shop.box.test:8080/' }])).toBe(
    'http://new-api.box.test:8080'
  );
});

it('ignores URLs that are not the slug under a zone, such as custom domains', () => {
  expect(predictedAppUrl('new-api', [{ slug: 'shop', url: 'https://www.example.com' }])).toBe(
    'https://new-api.gregale.dev'
  );
});

it('falls back to the documented default zone with no app to learn from', () => {
  expect(predictedAppUrl('first-app')).toBe('https://first-app.gregale.dev');
});
