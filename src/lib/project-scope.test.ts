import { describe, expect, it } from 'vitest';
import {
  STANDALONE,
  inScope,
  isAccountPath,
  projectOfLocation,
  validateProjectSearch,
  type ProjectScope,
} from './project-scope';
import { switchTarget } from '@/components/dashboard/project-switcher';

describe('project scope', () => {
  it('reads the project from its page first, then from ?project=', () => {
    expect(projectOfLocation('/dashboard/projects/acme-shop', { project: 'other' })).toBe(
      'acme-shop'
    );
    expect(projectOfLocation('/dashboard/releases', { project: 'acme-shop' })).toBe('acme-shop');
    expect(projectOfLocation('/dashboard/releases', {})).toBeNull();
  });

  it('accepts real slugs and the standalone scope, nothing else', () => {
    expect(validateProjectSearch({ project: 'acme-shop' })).toEqual({ project: 'acme-shop' });
    expect(validateProjectSearch({ project: STANDALONE })).toEqual({ project: STANDALONE });
    expect(validateProjectSearch({ project: '../etc' })).toEqual({});
    expect(validateProjectSearch({ project: 3 })).toEqual({});
  });

  it('treats the way in and the account pages as account level', () => {
    for (const path of [
      '/dashboard',
      '/dashboard/projects',
      '/dashboard/usage',
      '/dashboard/settings',
    ])
      expect(isAccountPath(path), path).toBe(true);
    for (const path of [
      '/dashboard/releases',
      '/dashboard/projects/acme-shop',
      '/dashboard/apps/api',
    ])
      expect(isAccountPath(path), path).toBe(false);
  });

  it('keeps only rows of the scoped apps, and nothing while membership loads', () => {
    const rows = [{ app: 'api' }, { app: 'etl' }];
    const scope = (over: Partial<ProjectScope>): ProjectScope => ({
      project: 'acme-shop',
      label: 'acme-shop',
      appSlugs: new Set(['api']),
      settled: true,
      choices: [],
      ...over,
    });
    expect(inScope(rows, scope({}), (r) => r.app)).toEqual([{ app: 'api' }]);
    expect(inScope(rows, scope({ appSlugs: null }), (r) => r.app)).toEqual([]);
    expect(inScope(rows, scope({ project: null }), (r) => r.app)).toEqual(rows);
  });
});

describe('switchTarget', () => {
  it('keeps the section when switching, but opens the overview from a project’s own page', () => {
    expect(switchTarget('/dashboard/releases', 'internal-tools')).toEqual({
      to: '/dashboard/releases',
      search: { project: 'internal-tools' },
    });
    expect(switchTarget('/dashboard/projects/acme-shop', 'internal-tools').to).toBe(
      '/dashboard/projects/internal-tools'
    );
    expect(switchTarget('/dashboard/apps/api', STANDALONE)).toEqual({
      to: '/dashboard/apps',
      search: { project: STANDALONE },
    });
  });
});
