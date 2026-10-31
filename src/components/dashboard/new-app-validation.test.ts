import { expect, it } from 'vitest';
import { appNameError, appNameFromRepo } from './new-app-validation';

it.each(['api', 'api-gateway', 'a'.repeat(40)])('accepts %s', (name) => {
  expect(appNameError(name)).toBeUndefined();
});
it.each(['ab', 'a'.repeat(41), '-api', 'api-', 'my_api', 'my api', 'API'])(
  'rejects %s with complete guidance',
  (name) => {
    expect(appNameError(name)).toBe(
      'Use 3–40 lowercase letters, numbers or dashes; start and end with a letter or number.'
    );
  }
);
it('rejects the tag- prefix the API reserves for deployment-alias hostnames', () => {
  expect(appNameError('tag-api')).toBe(
    'Names starting with tag- are reserved for deployment-alias hostnames.'
  );
});
it('explains a missing name', () => {
  expect(appNameError('')).toBe('Enter an app name.');
});

it.each([
  ['acme/storefront', 'storefront'],
  ['acme/My.Cool_Repo', 'my-cool-repo'],
  ['acme/--edge--', 'edge'],
  ['acme/go', 'go-app'],
  ['acme/x', 'x-app'],
  ['acme/' + 'a'.repeat(39) + '-bc', 'a'.repeat(39)],
  ['acme/___', ''],
])('derives an app name from %s', (repo, name) => {
  expect(appNameFromRepo(repo)).toBe(name);
  if (name) expect(appNameError(name)).toBeUndefined();
});
