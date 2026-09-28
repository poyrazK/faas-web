import { expect, it } from 'vitest';
import { appNameError } from './new-app-validation';

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
it('explains a missing name', () => {
  expect(appNameError('')).toBe('Enter an app name.');
});
