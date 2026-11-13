import { describe, expect, it } from 'vitest';
import { bucketSentence, contentsWords, sizeWords, visibilityWords } from './bucket-words';

const bucket = { public: false };
const file = (size_bytes: number) => ({ size_bytes });

describe('bucket words', () => {
  it('says what the first page holds, and only claims a total when there is no next page', () => {
    expect(contentsWords(undefined)).toBeUndefined();
    expect(contentsWords({ items: [] })).toBe('is empty');
    expect(contentsWords({ items: [file(734)] })).toBe('holds 1 file (734 B)');
    expect(contentsWords({ items: [file(1024), file(1536)] })).toBe('holds 2 files (2.5 KB)');
    expect(contentsWords({ items: [file(1), file(2)], next_cursor: 'c' })).toBe(
      'holds more than 2 files'
    );
  });

  it('calls a bucket public only when it is served at a path', () => {
    expect(visibilityWords(bucket, 'api')).toBe('is private');
    expect(visibilityWords({ public: true }, 'api')).toBe('is private');
    expect(visibilityWords({ public: true, serve_at: '/static' }, 'api')).toBe(
      "is public at /static on api's address"
    );
  });

  it('joins both into one sentence, and says less while the listing is unknown', () => {
    expect(bucketSentence(bucket, 'api', { items: [file(2048)] })).toBe(
      'It holds 1 file (2.0 KB) and is private.'
    );
    expect(bucketSentence(bucket, 'api')).toBe('It is private.');
  });

  it('formats sizes in binary steps', () => {
    expect(sizeWords(0)).toBe('0 B');
    expect(sizeWords(18 * 1024 * 1024)).toBe('18 MB');
  });
});
