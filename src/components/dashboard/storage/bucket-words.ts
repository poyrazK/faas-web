/*
 * A bucket in one sentence: what is in it and whether the internet can read
 * it, built from the bucket row and the first page of its listing. Who holds
 * a key is the access summary's sentence, right under this one.
 *
 * `public` only serves files when the bucket also names a `serve_at` path on
 * the app's hostname (faas pkg/objectstorage/upload.go, public_read.go), so a
 * public flag without one is not called public.
 */

interface BucketFacts {
  public: boolean;
  serve_at?: string;
}

interface FirstPage {
  items: { size_bytes: number }[];
  next_cursor?: string;
}

const NUMBER = new Intl.NumberFormat('en-US');

/** 734 B, 1.2 KB, 18 MB. */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** "holds 8 files (1.3 KB)", "is empty", "holds more than 100 files". Undefined while unknown. */
export function contentsWords(page: FirstPage | undefined): string | undefined {
  if (!page) return undefined;
  const n = page.items.length;
  if (page.next_cursor) return `holds more than ${NUMBER.format(n)} files`;
  if (n === 0) return 'is empty';
  const total = page.items.reduce((sum, o) => sum + o.size_bytes, 0);
  return `holds ${NUMBER.format(n)} ${n === 1 ? 'file' : 'files'} (${sizeWords(total)})`;
}

/** "is private", or "is public at /static on api-gateway's address". */
export function visibilityWords(bucket: BucketFacts, app: string): string {
  if (bucket.public && bucket.serve_at)
    return `is public at ${bucket.serve_at} on ${app}'s address`;
  return 'is private';
}

/** "It holds 8 files (1.3 KB) and is private." — said under the bucket's name. */
export function bucketSentence(bucket: BucketFacts, app: string, page?: FirstPage): string {
  const contents = contentsWords(page);
  const visibility = visibilityWords(bucket, app);
  return contents ? `It ${contents} and ${visibility}.` : `It ${visibility}.`;
}
