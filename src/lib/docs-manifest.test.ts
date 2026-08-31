import { describe, expect, it } from 'vitest';
import { DOC_ENTRIES, DOC_SECTIONS, findDoc } from './docs-manifest';
import { docSource } from './docs-content';

/** Every published slug has a file behind it, once; the CLI section holds setup and the reference. */
describe('docs manifest', () => {
  it('has unique slugs and a file for each', () => {
    const slugs = DOC_ENTRIES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(docSource(slug), slug).toBeTruthy();
  });

  it('publishes the generated CLI reference next to CLI setup', () => {
    const cli = DOC_SECTIONS.find((s) => s.title === 'CLI');
    expect(cli?.entries.map((e) => e.slug)).toEqual(['cli', 'cli-reference']);
    expect(findDoc('cli-reference')?.source).toBe('docs/cli-reference.md');
  });
});
