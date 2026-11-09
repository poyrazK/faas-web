import { expect, it } from 'vitest';
import type { AccessConnection } from '@/lib/storage-access';
import { accessSentence } from './access-summary';

const c = (
  lane: AccessConnection['lane'],
  permission: AccessConnection['permission'],
  id = `${lane}-${permission}-${Math.random()}`
): AccessConnection => ({ id, lane, label: id, permission });

it('says nothing can reach a bucket with no connections', () => {
  expect(accessSentence([])).toEqual({ lead: 'Nothing can reach these files yet.', rest: '' });
});

it('names readers first, and writers who can also read as "also"', () => {
  expect(
    accessSentence([c('app', 'read'), c('api-key', 'read'), c('s3-key', 'read_write')])
  ).toEqual({
    lead: 'Your app and two keys can read these files.',
    rest: 'One key can also change them.',
  });
});

it('drops "also" when a writer cannot read', () => {
  expect(accessSentence([c('app', 'read_write'), c('api-key', 'write')])).toEqual({
    lead: 'Your app can read these files.',
    rest: 'Your app and one key can change them.',
  });
});

it('says a write-only key cannot read', () => {
  expect(accessSentence([c('s3-key', 'write')])).toEqual({
    lead: 'One key can add or change files here but not read them.',
    rest: '',
  });
});

it('counts many keys in digits', () => {
  const keys = Array.from({ length: 12 }, (_, i) => c('api-key', 'read', `k${i}`));
  expect(accessSentence(keys).lead).toBe('12 keys can read these files.');
});
