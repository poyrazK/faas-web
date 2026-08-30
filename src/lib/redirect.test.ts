import { describe, expect, it } from 'vitest';
import { safeInternalPath } from './redirect';

describe('safeInternalPath', () => {
  it('accepts a same-origin path and its query string', () => {
    expect(safeInternalPath('/cli-auth?code=ABCD-1234')).toBe('/cli-auth?code=ABCD-1234');
  });

  it('rejects external and protocol-relative URLs', () => {
    expect(safeInternalPath('https://attacker.example')).toBeUndefined();
    expect(safeInternalPath('//attacker.example/path')).toBeUndefined();
  });

  it('rejects backslash-based browser URL variants', () => {
    expect(safeInternalPath('/\\/attacker.example')).toBeUndefined();
  });

  it('rejects non-string values', () => {
    expect(safeInternalPath(undefined)).toBeUndefined();
    expect(safeInternalPath({ path: '/dashboard' })).toBeUndefined();
  });
});
