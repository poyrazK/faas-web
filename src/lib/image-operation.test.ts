import { beforeEach, expect, it } from 'vitest';
import {
  newImageOperation,
  saveImageOperation,
  readImageOperation,
  creationReplayAllowed,
  clearImageOperation,
} from './image-operation';
const request = { image: `r/x@sha256:${'a'.repeat(64)}` };
beforeEach(() => localStorage.clear());
it('persists frozen non-secret identity before creating an app', () => {
  const operation = newImageOperation(
    'account-a',
    { slug: 'my-api', type: 'app', ram_mb: 128 },
    request
  );
  saveImageOperation(operation);
  expect(readImageOperation('account-a', '')).toEqual(operation);
  expect(operation.createKey).not.toBe(operation.deployKey);
  expect(readImageOperation('account-b', '')).toBeNull();
  expect(creationReplayAllowed(operation, operation.createdAt + 24 * 60 * 60 * 1000)).toBe(false);
  expect(creationReplayAllowed(operation, operation.createdAt + 1000)).toBe(true);
});
it('retains reviewed internal visibility in the non-secret recovery record', () => {
  const operation = newImageOperation(
    'account-a',
    { slug: 'private-api', type: 'app', visibility: 'internal' },
    request
  );
  saveImageOperation(operation);
  expect(readImageOperation('account-a', '')?.createRequest.visibility).toBe('internal');
  expect(localStorage.getItem('gregale.image-operation:account-a:new')).not.toContain('endpoint');
});
it('retains accepted identities and isolates new versus existing app recovery', () => {
  const operation = {
    ...newImageOperation('a', { slug: 'api', type: 'app' }, request),
    appId: 'app-1',
    deploymentId: 'release-1',
    stage: 'accepted' as const,
  };
  saveImageOperation(operation);
  expect(readImageOperation('a', '')?.deploymentId).toBe('release-1');
  expect(readImageOperation('a', 'api')).toBeNull();
  clearImageOperation(operation);
  expect(readImageOperation('a', '')).toBeNull();
});
it('allowlists persisted fields instead of saving credentials or secret overrides', () => {
  const operation = newImageOperation('a', { slug: 'api', type: 'app' }, request);
  saveImageOperation({
    ...operation,
    password: 'secret',
    deployRequest: { ...request, overrides: { env: { SECRET: 'secret' } } },
  } as never);
  expect(localStorage.getItem('gregale.image-operation:a:new')).not.toContain('secret');
  expect(readImageOperation('a', '')?.deployRequest).toEqual(request);
});
it('does not silently erase malformed recovery records', () => {
  localStorage.setItem('gregale.image-operation:a:new', '{bad');
  expect(() => readImageOperation('a', '')).toThrow(/recovery/i);
  expect(localStorage.getItem('gregale.image-operation:a:new')).toBe('{bad');
});
