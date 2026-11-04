import { describe, expect, it } from 'vitest';
import { base64ToText, realtimeClientUrl, textToBase64, utf8Bytes } from './realtime';

describe('realtime helpers', () => {
  it('builds the client URL on the app host (docs/realtime.md § Connect clients)', () => {
    expect(realtimeClientUrl('https://shop.gregale.app/some/path', 'ep-1')).toBe(
      'wss://shop.gregale.app/__gregale/realtime/ep-1'
    );
    expect(realtimeClientUrl(undefined, 'ep-1')).toBeUndefined();
    expect(realtimeClientUrl('not a url', 'ep-1')).toBeUndefined();
  });

  it('round-trips UTF-8 text through the base64 apid takes', () => {
    const text = 'naïve ✓ {"id":42}';
    expect(base64ToText(textToBase64(text), false)).toBe(text);
    expect(textToBase64('hello')).toBe(btoa('hello'));
  });

  it('shows no text for a binary or non-UTF-8 payload', () => {
    expect(base64ToText(btoa('hello'), true)).toBeUndefined();
    expect(base64ToText(btoa('\xff\xfe'), false)).toBeUndefined();
  });

  it('measures payloads in bytes, the unit of the 1 MiB and 4 KiB limits', () => {
    expect(utf8Bytes('é')).toBe(2);
  });
});
