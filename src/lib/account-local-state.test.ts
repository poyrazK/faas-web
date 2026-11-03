import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNT_LOCAL_KEYS, claimAccountLocalState } from './account-local-state';

afterEach(() => window.localStorage.clear());

function seed() {
  for (const key of ACCOUNT_LOCAL_KEYS) window.localStorage.setItem(key, 'previous');
  window.localStorage.setItem('gregale.sidebar.collapsed', 'true');
}

describe('claimAccountLocalState', () => {
  it('adopts state written before an owner was recorded', () => {
    seed();
    expect(claimAccountLocalState('alice@example.com')).toBe(false);
    for (const key of ACCOUNT_LOCAL_KEYS) expect(window.localStorage.getItem(key)).toBe('previous');
  });

  it('keeps the same account’s state, whatever the address case', () => {
    claimAccountLocalState('alice@example.com');
    seed();
    expect(claimAccountLocalState(' Alice@Example.com ')).toBe(false);
    for (const key of ACCOUNT_LOCAL_KEYS) expect(window.localStorage.getItem(key)).toBe('previous');
  });

  it('clears another account’s state and keeps layout preferences', () => {
    claimAccountLocalState('alice@example.com');
    seed();
    expect(claimAccountLocalState('bob@example.com')).toBe(true);
    for (const key of ACCOUNT_LOCAL_KEYS) expect(window.localStorage.getItem(key)).toBeNull();
    expect(window.localStorage.getItem('gregale.sidebar.collapsed')).toBe('true');
    // Bob owns the browser now; his own state survives his next sign-in.
    window.localStorage.setItem('gregale.recents', 'bob');
    expect(claimAccountLocalState('bob@example.com')).toBe(false);
    expect(window.localStorage.getItem('gregale.recents')).toBe('bob');
  });
});

/**
 * Each key is defined where it is read. If one is renamed there, it would
 * silently stop being cleared, so every listed key must still appear in a
 * source file other than the list itself.
 */
describe('ACCOUNT_LOCAL_KEYS', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(name) && !/\.test\./.test(name) && !/account-local-state/.test(name)
        ? [full]
        : [];
    });
  }
  const sources = walk(resolve('src')).map((file) => readFileSync(file, 'utf8'));

  it.each(ACCOUNT_LOCAL_KEYS.filter((key) => key !== 'gregale.onboarded'))(
    '%s is still used by the console',
    (key) => {
      expect(sources.some((source) => source.includes(`'${key}'`))).toBe(true);
    }
  );
});
