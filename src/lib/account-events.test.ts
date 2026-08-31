import { describe, expect, it } from 'vitest';
import { parseAccountFrame } from './account-events';

/** The frame the CLI's `tail` prints, parsed once; a bad frame is dropped, not thrown. */
describe('parseAccountFrame', () => {
  it('parses the four fields and stamps receipt time', () => {
    expect(
      parseAccountFrame(
        '{"invocation_id":"i1","app_id":"a1","app_slug":"hello","state":"completed"}',
        5
      )
    ).toEqual({
      invocation_id: 'i1',
      app_id: 'a1',
      app_slug: 'hello',
      state: 'completed',
      receivedAt: 5,
    });
  });

  it('returns null for malformed data', () => {
    expect(parseAccountFrame('not json', 5)).toBeNull();
    expect(parseAccountFrame('{"app_id":"a1"}', 5)).toBeNull();
  });
});
