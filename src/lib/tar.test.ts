import { describe, expect, it } from 'vitest';
import { tarball } from './tar';

const text = (bytes: Uint8Array, from: number, length: number) =>
  new TextDecoder().decode(bytes.slice(from, from + length)).replace(/\0.*$/s, '');

describe('tarball', () => {
  it('writes each file as a ustar entry the server can read', () => {
    const out = tarball([{ name: 'handler.js', content: 'export const a = 1;\n' }]);
    // One 512-byte header, the content padded to 512, then two empty blocks.
    expect(out.length).toBe(512 + 512 + 1024);
    expect(text(out, 0, 100)).toBe('handler.js');
    expect(text(out, 124, 12)).toBe((20).toString(8).padStart(11, '0'));
    expect(text(out, 257, 6)).toBe('ustar');
    expect(String.fromCharCode(out[156])).toBe('0');
    expect(text(out, 512, 20)).toBe('export const a = 1;\n');
    expect(out.slice(out.length - 1024).every((b) => b === 0)).toBe(true);
  });

  it('checksums each header the way tar does', () => {
    const out = tarball([{ name: 'handler.py', content: 'x = 1\n' }]);
    const header = out.slice(0, 512);
    const stored = parseInt(text(header, 148, 7), 8);
    const blanked = header.slice();
    blanked.fill(0x20, 148, 156);
    expect(stored).toBe(blanked.reduce((sum, b) => sum + b, 0));
  });

  it('keeps several files in order, each on a block boundary', () => {
    const out = tarball([
      { name: 'package.json', content: '{}' },
      { name: 'handler.js', content: 'a'.repeat(600) },
    ]);
    expect(text(out, 0, 100)).toBe('package.json');
    expect(text(out, 1024, 100)).toBe('handler.js');
    expect(out.length).toBe(512 + 512 + 512 + 1024 + 1024);
  });

  it('counts content in bytes, not characters', () => {
    const out = tarball([{ name: 'handler.py', content: 'é' }]);
    expect(text(out, 124, 12)).toBe('00000000002');
  });
});
