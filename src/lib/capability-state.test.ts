import { describe, expect, it } from 'vitest';
import { capabilityAccess, capabilityStage, capabilityViewState } from './capability-state';
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
    expect(safeCapabilityDocs('/docs/custom-domains#verify')).toBe('/docs/custom-domains#verify');
    expect(safeCapabilityDocs('https://gregale.dev/docs/security')).toBe('/docs/security');
    // Registry pages held back from the site (docs-catalog.ts UNPUBLISHED_DOCS).
    expect(safeCapabilityDocs('/docs/object-storage#limits')).toBeUndefined();
    expect(safeCapabilityDocs('https://gregale.dev/docs/executions')).toBeUndefined();
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
    expect(capabilityEntrypoint('container-deployments').href).toBe(
      '/dashboard/apps/new?source=container'
    );
    expect(capabilityEntrypoint('worker-pools').href).toBe('/dashboard/apps/new?source=worker');
    expect(capabilityEntrypoint('future-key').href).toBeUndefined();
  });
});

describe('capabilityAccess', () => {
  const registry = (over: Record<string, unknown> = {}) =>
    ({
      registry_version: 1,
      plan: 'pro',
      capabilities: [
        { key: 'traffic-mirroring', maturity: 'preview', plans: ['pro'], enabled: true },
        {
          key: 'issues',
          maturity: 'preview',
          plans: ['scale'],
          enabled: false,
          unavailable_reason: 'plan_not_entitled',
        },
        {
          key: 'object-storage',
          maturity: 'preview',
          plans: ['pro'],
          enabled: false,
          unavailable_reason: 'runtime_unavailable',
        },
      ],
      ...over,
    }) as never;

  it('waits for the registry, and reports a registry error as itself', () => {
    expect(capabilityAccess(undefined, 'issues', 'loading')).toBe('loading');
    expect(capabilityAccess(undefined, 'issues', 'error')).toBe('registry-error');
  });
  it('treats a hidden capability as off, internal ones included', () => {
    const r = registry({ hidden_capabilities: ['traffic-mirroring', 'route-insights'] });
    expect(capabilityAccess(r, 'traffic-mirroring', 'ready')).toBe('off');
    expect(capabilityAccess(r, 'route-insights', 'ready')).toBe('off');
  });
  it('treats an internal capability that is not hidden as released to this account', () => {
    expect(capabilityAccess(registry({ hidden_capabilities: [] }), 'route-insights', 'ready')).toBe(
      'on'
    );
  });
  it('treats everything as on when the server has no capability gate', () => {
    // hidden_capabilities is omitted by servers without the gate (faas handlers_capabilities.go:65)
    expect(capabilityAccess(registry(), 'route-insights', 'ready')).toBe('on');
    expect(capabilityAccess(registry(), 'traffic-mirroring', 'ready')).toBe('on');
  });
  it('keeps the plan and runtime reasons for listed entries', () => {
    expect(capabilityAccess(registry(), 'issues', 'ready')).toBe('plan-not-entitled');
    expect(capabilityAccess(registry(), 'object-storage', 'ready')).toBe('runtime-unavailable');
  });
});

describe('capabilityStage', () => {
  it('labels beta and preview from the maturity, and nothing else', () => {
    expect(capabilityStage('beta')).toBe('Beta');
    expect(capabilityStage('preview')).toBe('Preview');
    expect(capabilityStage('ga')).toBe('');
    expect(capabilityStage('internal')).toBe('');
    expect(capabilityStage(undefined)).toBe('');
  });
});
