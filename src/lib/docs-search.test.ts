import { describe, expect, it } from 'vitest';
import { searchDocs } from './docs-search';
import { findDoc, DOC_ENTRIES } from './docs-manifest';

describe('documentation search', () => {
  it('finds error codes and commands inside articles', () => {
    expect(searchDocs('source_ref_unavailable').map((result) => result.entry.slug)).toContain(
      'deploy-from-source'
    );
    expect(
      searchDocs('gregale completion powershell').map((result) => result.entry.slug)
    ).toContain('cli');
  });
  it('ranks title matches first and returns readable excerpts', () => {
    const results = searchDocs('deploy your first app');
    expect(results[0].entry.slug).toBe('getting-started');
    expect(results[0].excerpt.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(8);
  });
  it('handles empty and unmatched searches', () => {
    expect(searchDocs('   ')).toEqual([]);
    expect(searchDocs('qzzzx-unfindable-document')).toEqual([]);
  });
  it('starts with a locally maintained guide that upstream pulls must preserve', () => {
    expect(DOC_ENTRIES[0].slug).toBe('getting-started');
    expect(findDoc('getting-started')?.local).toBe(true);
    expect(findDoc('cli')?.local).toBeUndefined();
  });
});
