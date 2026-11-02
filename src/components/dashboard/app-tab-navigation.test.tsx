import { describe, expect, it } from 'vitest';
import {
  APP_TAB_CAPABILITY,
  APP_TAB_GROUPS,
  resolveAppTab,
  visibleAppTabs,
} from './app-tab-navigation';

const group = (label: string) => APP_TAB_GROUPS.find((g) => g.label === label)?.tabs;

it('resolves retired tab names so old links still land', () => {
  expect(resolveAppTab('Secrets')).toBe('Environment');
  expect(resolveAppTab('Env vars')).toBe('Environment');
  expect(resolveAppTab('Invoke')).toBe('Overview');
  expect(resolveAppTab('Logs')).toBe('Logs');
  expect(resolveAppTab('nope')).toBeUndefined();
  expect(resolveAppTab(3)).toBeUndefined();
});

it('files metrics with the other Observe sections', () => {
  expect(group('Observe')?.[0]).toBe('Metrics');
  expect(group('Overview')).toEqual(['Overview']);
});

describe('visibleAppTabs', () => {
  it('hides tabs whose capability is off and keeps GA tabs', () => {
    const tabs = visibleAppTabs((id) =>
      id === 'traffic-mirroring' || id === 'route-insights' ? 'off' : 'on'
    );
    expect(tabs).not.toContain('Mirrors');
    expect(tabs).not.toContain('Routes');
    expect(tabs).toContain('Deployments');
    expect(tabs).toContain('Debugger');
  });
  it('keeps every tab while the registry is loading or errored, so nothing flickers away', () => {
    expect(visibleAppTabs(() => 'loading')).toContain('Mirrors');
    expect(visibleAppTabs(() => 'registry-error')).toContain('Mirrors');
  });
  it('keeps a tab that is listed but not in the plan, so the upgrade notice can show', () => {
    expect(visibleAppTabs(() => 'plan-not-entitled')).toContain('Issues');
  });
  it('maps every gated tab to a catalog id', () => {
    expect(APP_TAB_CAPABILITY.Debugger).toBe('production-debugger');
    expect(APP_TAB_CAPABILITY.Automations).toBe('automations');
  });
  it('hides Log drains when apid gates the log-drains capability off', () => {
    expect(APP_TAB_CAPABILITY['Log drains']).toBe('log-drains');
    expect(visibleAppTabs((id) => (id === 'log-drains' ? 'off' : 'on'))).not.toContain(
      'Log drains'
    );
  });
});
