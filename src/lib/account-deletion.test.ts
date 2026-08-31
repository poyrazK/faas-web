import { describe, expect, it } from 'vitest';
import { deletionMessage } from './account-deletion';

/**
 * The one sentence the user must read after staging deletion: that it is
 * scheduled, not done, and exactly until when it can be undone.
 */
describe('deletionMessage', () => {
  it('names the restore deadline in the user’s locale', () => {
    const msg = deletionMessage('2026-08-22T11:25:00Z');
    expect(msg).toMatch(/restore it until/i);
    expect(msg).toContain(new Date('2026-08-22T11:25:00Z').toLocaleDateString());
  });
});
