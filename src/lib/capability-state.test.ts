import { describe, expect, it } from 'vitest';
import { capabilityViewState } from './capability-state';
import { capabilityEntrypoint, safeCapabilityDocs } from './capability-entrypoints';
import type { components } from './api/schema';

const capability: components['schemas']['CapabilityStatus'] = {
  key: 'object-storage',
  name: 'Private object storage',
  category: 'data',
  description: 'Private buckets.',
  maturity: 'preview',
  plans: ['hobby', 'pro', 'scale'],
  docs_url: '/docs/object-storage',
  acceptance: 'provider-qualification',
  enabled: false,
};

describe('capability availability', () => {
  it('does not offer a Scale upgrade for a runtime outage', () => {
    expect(
      capabilityViewState(
        { ...capability, unavailable_reason: 'runtime_unavailable' },
        'ready',
        'scale'
      )
    ).toBe('runtime-unavailable');
  });
  it('rejects retained enabled data after a registry read fails', () => {
    expect(capabilityViewState({ ...capability, enabled: true }, 'error', 'scale')).toBe(
      'registry-error'
    );
  });
  it('does not authorize during a refresh or for an absent/internal key', () => {
    expect(capabilityViewState({ ...capability, enabled: true }, 'loading', 'scale')).toBe(
      'loading'
    );
    expect(capabilityViewState(undefined, 'ready', 'scale')).toBe('unknown');
    expect(
      capabilityViewState({ ...capability, enabled: true, maturity: 'internal' }, 'ready', 'scale')
    ).toBe('unknown');
  });
  it('uses explicit reasons and conservative legacy entitlement fallback', () => {
    expect(capabilityViewState(capability, 'ready', 'scale')).toBe('unknown');
    expect(capabilityViewState(capability, 'ready', 'free')).toBe('plan-not-entitled');
    expect(capabilityViewState({ ...capability, enabled: true }, 'ready', 'hobby')).toBe(
      'available'
    );
  });
});
describe('verified capability destinations', () => {
  it('accepts only published docs on approved origins', () => {
    expect(safeCapabilityDocs('/docs/object-storage#limits')).toBe('/docs/object-storage#limits');
    expect(safeCapabilityDocs('https://gregale.dev/docs/executions')).toBe('/docs/executions');
    for (const url of [
      'javascript:alert(1)',
      '//evil.test/docs/executions',
      'https://evil.test/docs/executions',
      '/docs/../dashboard',
      '/docs/not-published',
      '/docs/%2e%2e/executions',
    ]) {
      expect(safeCapabilityDocs(url)).toBeUndefined();
    }
  });
  it('hands missing console journeys to explicit CLI guidance without invented routes', () => {
    expect(capabilityEntrypoint('object-storage').href).toBe('/dashboard/storage');
    expect(capabilityEntrypoint('container-deployments').instruction).toMatch(/CLI/);
    expect(capabilityEntrypoint('future-key').href).toBeUndefined();
  });
});
