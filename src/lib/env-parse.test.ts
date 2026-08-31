import { describe, expect, it } from 'vitest';
import { parseDotEnv } from './env-parse';

describe('parseDotEnv', () => {
  it('reads plain assignments and skips comments and blanks', () => {
    const { entries, invalid } = parseDotEnv('# db\nDATABASE_URL=postgres://x\n\nPORT=3000\n');
    expect(entries).toEqual([
      { key: 'DATABASE_URL', value: 'postgres://x' },
      { key: 'PORT', value: '3000' },
    ]);
    expect(invalid).toEqual([]);
  });

  it('strips export prefixes and wrapping quotes, keeps inner equals', () => {
    const { entries } = parseDotEnv(
      'export TOKEN="abc=def"\nSINGLE=\'  spaced  \'\nURL=https://a?b=c'
    );
    expect(entries).toEqual([
      { key: 'TOKEN', value: 'abc=def' },
      { key: 'SINGLE', value: '  spaced  ' },
      { key: 'URL', value: 'https://a?b=c' },
    ]);
  });

  it('drops trailing comments only on unquoted values', () => {
    const { entries } = parseDotEnv('A=1 # one\nB="2 # not a comment"');
    expect(entries).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2 # not a comment' },
    ]);
  });

  it('reports junk lines and lets later assignments win', () => {
    const { entries, invalid } = parseDotEnv('not a line\nK=1\nK=2\n=nokey');
    expect(entries).toEqual([{ key: 'K', value: '2' }]);
    expect(invalid).toEqual(['not a line', '=nokey']);
  });

  it('handles CRLF files', () => {
    const { entries } = parseDotEnv('A=1\r\nB=2\r\n');
    expect(entries).toHaveLength(2);
  });
});
