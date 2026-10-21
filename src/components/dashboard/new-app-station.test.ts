import { describe, expect, it } from 'vitest';
import { hasSetup, stationFor, stepForStation } from './new-app-station';
import { validateNewAppSearch } from './new-app-source';

const at = (i: Partial<Parameters<typeof stationFor>[0]>) =>
  stationFor({ named: false, sourceValid: false, nameValid: false, ...i });

describe('stationFor', () => {
  it('opens on Sources with nothing chosen, or with a source only inferred', () => {
    expect(at({})).toBe('sources');
    expect(at({ source: 'git', named: false, sourceValid: true })).toBe('sources');
  });

  it('lands a source named in the URL on its Setup (GitHub return, template links)', () => {
    expect(at({ source: 'git', named: true })).toBe('setup');
    expect(at({ source: 'template', named: true })).toBe('setup');
    expect(at({ source: 'import', named: true })).toBe('setup');
  });

  it('keeps a named Empty on Sources, since it has no Setup', () => {
    expect(at({ source: 'empty', named: true, sourceValid: true })).toBe('sources');
  });

  it('honours the explicit markers', () => {
    expect(at({ source: 'git', named: true, step: 'source' })).toBe('sources');
    expect(at({ source: 'template', named: true, step: 'setup' })).toBe('setup');
    expect(at({ source: 'empty', named: true, step: 'setup', sourceValid: true })).toBe(
      'configure'
    );
  });

  it('reaches Configure and Review only when what they need is valid', () => {
    expect(at({ source: 'git', named: true, step: 'configure', sourceValid: true })).toBe(
      'configure'
    );
    expect(at({ source: 'git', named: true, step: 'configure' })).toBe('setup');
    expect(at({ source: 'empty', named: true, step: 'configure' })).toBe('sources');
    expect(
      at({ source: 'git', named: true, step: 'review', sourceValid: true, nameValid: true })
    ).toBe('review');
    expect(at({ source: 'git', named: true, step: 'review', sourceValid: true })).toBe('configure');
  });
});

describe('stepForStation', () => {
  it('writes back the marker the URL needs to come back to the same station', () => {
    expect(stepForStation('review', 'review')).toBe('review');
    expect(stepForStation('configure', 'review')).toBe('configure');
    expect(stepForStation('setup', 'setup')).toBe('setup');
    expect(stepForStation('setup', 'configure')).toBeUndefined();
    expect(stepForStation('sources', 'source')).toBe('source');
    expect(stepForStation('sources', undefined)).toBeUndefined();
  });
});

describe('the step markers in the URL', () => {
  it('accepts source and setup', () => {
    expect(validateNewAppSearch({ step: 'setup' }).step).toBe('setup');
    expect(validateNewAppSearch({ step: 'source' }).step).toBe('source');
    expect(validateNewAppSearch({ step: 'nope' }).step).toBeUndefined();
  });

  it('knows which sources have a Setup', () => {
    expect(
      ['git', 'template', 'empty', 'container', 'worker', 'import'].map((s) => hasSetup(s as never))
    ).toEqual([true, true, false, true, true, true]);
  });
});
