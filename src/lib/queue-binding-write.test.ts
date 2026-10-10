import { expect, it } from 'vitest';
import { listQueueBindingWrites, saveQueueBindingWrite } from './queue-binding-write';

it('lists only safe account and app write records for missing binding recovery', () => {
  sessionStorage.clear();
  saveQueueBindingWrite({
    version: 1,
    accountId: 'a1',
    slug: 'app-1',
    appId: 'id-1',
    bindingId: 'b1',
    action: 'delete',
    beforeFingerprint: 'fp',
    createdAt: 1,
  });
  saveQueueBindingWrite({
    version: 1,
    accountId: 'a2',
    slug: 'app-1',
    appId: 'id-2',
    bindingId: 'b2',
    action: 'update',
    beforeFingerprint: 'fp',
    createdAt: 2,
  });
  expect(listQueueBindingWrites('a1', 'app-1')).toMatchObject([{ bindingId: 'b1' }]);
  expect(listQueueBindingWrites('a1', 'app-2')).toEqual([]);
});
