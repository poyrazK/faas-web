import { describe, expect, it } from 'vitest';
import { RELEASE_PANELS, panelForSection, validateReleasePageSearch } from './panels';

describe('validateReleasePageSearch', () => {
  it('keeps a known panel and foreign search', () => {
    expect(validateReleasePageSearch({ panel: 'security', project: 'p' })).toEqual({
      panel: 'security',
      project: 'p',
    });
  });

  it('drops an unknown panel', () => {
    expect(validateReleasePageSearch({ panel: 'nope' }).panel).toBeUndefined();
  });
});

describe('panelForSection', () => {
  it.each([
    ['output', 'output'],
    ['provenance', 'provenance'],
    ['scans', 'security'],
    ['lifecycle', 'rollout'],
    ['runtime', 'runtime'],
    ['audit', 'activity'],
  ])('maps the old %s section to the %s popup', (section, panel) => {
    expect(panelForSection(section)).toBe(panel);
  });

  it('opens no popup for the overview or a missing section', () => {
    expect(panelForSection('overview')).toBeUndefined();
    expect(panelForSection(undefined)).toBeUndefined();
    expect(panelForSection('nonsense')).toBeUndefined();
  });
});

it('lists the ten popups in tile order', () => {
  expect(RELEASE_PANELS).toEqual([
    'changes',
    'output',
    'rollout',
    'runtime',
    'security',
    'provenance',
    'release-command',
    'canary',
    'activity',
    'details',
  ]);
});
