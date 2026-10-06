import { describe, expect, it } from 'vitest';
import { envImportDiff, parseEnvImport, serializeEnvExport } from './env-transfer';
describe('safe env transfer', () => {
  it('accepts comments, BOM, CRLF, empty values, exported names, quotes and inner equals', () => {
    const result = parseEnvImport(
      '\uFEFF# title\r\nexport LOG_LEVEL=debug # comment\r\nEMPTY=\r\nURL=https://test?a=b\r\nTEXT="two \\"quoted\\" words" # comment\r\nSINGLE=\' # literal \''
    );
    expect(result.diagnostics).toEqual([]);
    expect(Object.fromEntries(result.entries.map(({ key, value }) => [key, value]))).toEqual({
      LOG_LEVEL: 'debug',
      EMPTY: '',
      URL: 'https://test?a=b',
      TEXT: 'two "quoted" words',
      SINGLE: ' # literal ',
    });
  });
  it('excludes every occurrence of duplicate keys without choosing a value', () => {
    const result = parseEnvImport('A=first\nB=okay\nA=second');
    expect(result.entries).toEqual([{ key: 'B', value: 'okay' }]);
    expect(result.diagnostics.map((item) => [item.line, item.key])).toEqual([
      [1, 'A'],
      [3, 'A'],
    ]);
  });
  it('does not apply a key repeated with a malformed value', () => {
    const result = parseEnvImport('A=valid\nA="unfinished');
    expect(result.entries).toEqual([]);
    expect(result.diagnostics.filter((item) => item.reason.startsWith('Duplicate'))).toHaveLength(
      2
    );
  });
  it('redacts invalid input and rejects malformed quotes, names, NUL and oversized files', () => {
    const result = parseEnvImport(
      'bad_key=private-value\nprivate-value\nA="private-value\nB="x"junk\nC=\0\n' +
        'D'.repeat(129) +
        '=private-value'
    );
    expect(result.entries).toEqual([]);
    expect(result.diagnostics).toHaveLength(6);
    expect(JSON.stringify(result.diagnostics)).not.toContain('private-value');
    expect(parseEnvImport('A=' + 'x'.repeat(1024 * 1024)).entries).toEqual([]);
  });
  it('shows additions and overwrites from metadata without inventing value comparisons', () => {
    expect(
      envImportDiff(
        [
          { key: 'A', value: 'new' },
          { key: 'B', value: '' },
        ],
        new Set(['A'])
      )
    ).toEqual([
      { key: 'A', value: 'new', action: 'overwrite' },
      { key: 'B', value: '', action: 'add' },
    ]);
  });
  it('round-trips explicit exports with Unicode, spaces, line breaks and escaping', () => {
    const values = {
      A: '  # é 😀  ',
      B: 'line1\nline2\r\t',
      C: '"quote"\\path=with=dollars${NO_INTERPOLATION}',
      D: '',
    };
    const result = parseEnvImport(serializeEnvExport(values));
    expect(result.diagnostics).toEqual([]);
    expect(Object.fromEntries(result.entries.map(({ key, value }) => [key, value]))).toEqual(
      values
    );
  });
  it('refuses invalid export entries', () => {
    expect(() => serializeEnvExport({ invalid: 'value' })).toThrow();
    expect(() => serializeEnvExport({ A: '\0' })).toThrow();
  });
});
