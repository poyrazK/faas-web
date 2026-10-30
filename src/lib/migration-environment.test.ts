import { describe, expect, it } from 'vitest';
import { migrationEnvironment } from './migration-environment';

describe('migration environment', () => {
  it('satisfies mapped requirements and excludes pasted values for bound runtime keys', () => {
    expect(
      migrationEnvironment('API_URL=https://old-provider.test\nTOKEN=private', ['API_URL'], {
        API_URL: 'api',
      })
    ).toEqual({ values: { TOKEN: 'private' }, keys: ['TOKEN'], errors: [] });
    expect(migrationEnvironment('', ['API_URL'], { API_URL: 'api' }).errors).toEqual([]);
    expect(migrationEnvironment('API_URL=', ['API_URL'], { API_URL: 'api' }).errors).toEqual([]);
  });
  it('requires explicit declarations while allowing omitted detected optional keys', () => {
    expect(migrationEnvironment('DATABASE_URL=postgres://existing', ['DATABASE_URL'])).toEqual({
      values: { DATABASE_URL: 'postgres://existing' },
      keys: ['DATABASE_URL'],
      errors: [],
    });
    expect(migrationEnvironment('', ['DATABASE_URL']).errors).toEqual([
      'Required by your repository: DATABASE_URL.',
    ]);
  });
  it('keeps invalid and duplicate line contents out of diagnostics', () => {
    const result = migrationEnvironment(
      'bad secret-value\nTOKEN=secret-value\nTOKEN=other-secret\nbad-key=private-value'
    );
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(' ')).not.toMatch(/secret-value|other-secret|private-value/);
    expect(result.errors.join(' ')).toContain('TOKEN');
  });
  it('rejects empty values and handles equals signs inside credentials', () => {
    const parsed = migrationEnvironment('TOKEN="value=with=equals"\nOPTIONAL=');
    expect(parsed.values.TOKEN).toBe('value=with=equals');
    expect(parsed.errors).toEqual(['OPTIONAL is empty. Supply a value or omit this key.']);
  });
});
