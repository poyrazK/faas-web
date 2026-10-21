import { describe, expect, it } from 'vitest';
import { summaryRows, type SummaryInput } from './new-app-summary';
import { SOURCES, SOURCE_GROUPS, sourceName } from './new-app-sources';

const base: SummaryInput = {
  step: 0,
  source: 'git',
  repo: '',
  ref: 'main',
  name: '',
  workspaceLabel: 'Personal',
  workspaceIsOrg: false,
  appType: 'function',
  runtimeLabel: 'Node 22',
  memoryMb: 128,
  scaleToZero: true,
  visibility: 'public',
};
const keys = (input: Partial<SummaryInput>) => summaryRows({ ...base, ...input }).map((r) => r.key);
const value = (input: Partial<SummaryInput>, key: string) =>
  summaryRows({ ...base, ...input }).find((r) => r.key === key)?.value;

describe('summaryRows', () => {
  it('shows nothing before a source is chosen', () => {
    expect(summaryRows({ ...base, source: undefined })).toEqual([]);
  });

  it('adds only what is known on the source step', () => {
    expect(keys({})).toEqual(['source']);
    expect(keys({ repo: 'acme/storefront' })).toEqual(['source', 'repository']);
    expect(value({ repo: ' acme/storefront ', ref: ' ' }, 'repository')).toBe(
      'acme/storefront@main'
    );
    expect(keys({ repo: 'acme/storefront', name: 'storefront' })).toEqual([
      'source',
      'repository',
      'name',
    ]);
  });

  it('names a picked template, and nothing for a template not picked yet', () => {
    expect(keys({ source: 'template' })).toEqual(['source']);
    expect(value({ source: 'template', templateName: 'hello-node' }, 'template')).toBe(
      'hello-node'
    );
  });

  it('lists an org workspace early and the personal one only on review', () => {
    expect(keys({ workspaceIsOrg: true, workspaceLabel: 'acme' })).toContain('workspace');
    expect(keys({ step: 1 })).not.toContain('workspace');
    expect(value({ step: 2 }, 'workspace')).toBe('Personal');
  });

  it('adds configuration from the configure step, runtime only for functions', () => {
    expect(keys({ step: 1, name: 'api' })).toEqual([
      'source',
      'name',
      'type',
      'runtime',
      'memory',
      'scale',
      'visibility',
    ]);
    expect(keys({ step: 1, appType: 'app' })).not.toContain('runtime');
    expect(value({ step: 1, scaleToZero: false }, 'scale')).toBe('One instance kept resident');
    expect(value({ step: 1, memoryMb: 256 }, 'memory')).toBe('256 MB');
    expect(value({ step: 1, visibility: 'internal' }, 'visibility')).toBe('Internal service only');
  });

  it('says how the first deploy happens and what the URL is, on review', () => {
    expect(value({ step: 2, repo: 'acme/storefront' }, 'first-deploy')).toBe(
      'acme/storefront@main, right after create'
    );
    expect(value({ step: 2, source: 'empty' }, 'first-deploy')).toBe('Later, from the CLI');
    expect(value({ step: 2 }, 'url')).toBe('Assigned on create');
    expect(value({ step: 2, predictedUrl: 'https://api.gregale.app' }, 'url')).toBe(
      'https://api.gregale.app'
    );
    expect(value({ step: 2, visibility: 'internal', predictedUrl: 'x' }, 'url')).toBe(
      'None (internal service only)'
    );
  });
});

describe('the shared source list', () => {
  it('keeps the six sources, grouped with Git first', () => {
    expect(SOURCES.map((s) => s.id)).toEqual([
      'git',
      'template',
      'empty',
      'container',
      'worker',
      'import',
    ]);
    expect(SOURCE_GROUPS.flatMap((g) => g.sources)).toEqual(SOURCES.map((s) => s.id));
    expect(sourceName('git')).toBe('Git repository');
    expect(sourceName(undefined)).toBe('');
  });
});
