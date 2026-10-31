/**
 * A minimal ustar writer, enough to send a function's few source files as the
 * archive `POST /v1/apps/{slug}/deployments` takes. Regular files only, at the
 * archive root; `gzip()` compresses the result with the browser's own
 * CompressionStream, so no dependency is needed.
 */

const BLOCK = 512;
const encoder = new TextEncoder();

function field(header: Uint8Array, offset: number, length: number, value: string) {
  header.set(encoder.encode(value).slice(0, length), offset);
}

/** A number as tar writes it: zero-padded octal, NUL-terminated. */
const octal = (n: number, width: number) => n.toString(8).padStart(width - 1, '0') + '\0';

export function tarball(files: { name: string; content: string }[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const mtime = Math.floor(Date.now() / 1000);
  for (const file of files) {
    const body = encoder.encode(file.content);
    const header = new Uint8Array(BLOCK);
    field(header, 0, 100, file.name);
    field(header, 100, 8, octal(0o644, 8));
    field(header, 108, 8, octal(0, 8));
    field(header, 116, 8, octal(0, 8));
    field(header, 124, 12, octal(body.length, 12));
    field(header, 136, 12, octal(mtime, 12));
    field(header, 156, 1, '0');
    field(header, 257, 6, 'ustar\0');
    field(header, 263, 2, '00');
    // The checksum counts its own field as spaces.
    header.fill(0x20, 148, 156);
    const sum = header.reduce((total, b) => total + b, 0);
    field(header, 148, 8, sum.toString(8).padStart(6, '0') + '\0 ');
    parts.push(header, body, new Uint8Array((BLOCK - (body.length % BLOCK)) % BLOCK));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Blob> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}
