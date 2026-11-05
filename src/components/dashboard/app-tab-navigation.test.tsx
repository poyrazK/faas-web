import { describe, expect, it } from 'vitest';
import {
  APP_TAB_ANY_CAPABILITY,
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
    expect(APP_TAB_CAPABILITY.Debugger).toBe('debug');
    expect(APP_TAB_CAPABILITY.Automations).toBe('automations');
  });
  it('hides Forks when apid gates production forks off, and keeps it for the plan notice', () => {
    expect(APP_TAB_CAPABILITY.Forks).toBe('production-forks');
    expect(visibleAppTabs((id) => (id === 'production-forks' ? 'off' : 'on'))).not.toContain(
      'Forks'
    );
    expect(
      visibleAppTabs((id) => (id === 'production-forks' ? 'plan-not-entitled' : 'on'))
    ).toContain('Forks');
  });
  it('hides Profile captures when apid gates the preview off, and keeps it for the plan notice', () => {
    expect(APP_TAB_CAPABILITY['Profile captures']).toBe('profile-captures');
    expect(visibleAppTabs((id) => (id === 'profile-captures' ? 'off' : 'on'))).not.toContain(
      'Profile captures'
    );
    expect(
      visibleAppTabs((id) => (id === 'profile-captures' ? 'plan-not-entitled' : 'on'))
    ).toContain('Profile captures');
  });
  it('hides Log drains when apid gates the log-drains capability off', () => {
    expect(APP_TAB_CAPABILITY['Log drains']).toBe('log-drains');
    expect(visibleAppTabs((id) => (id === 'log-drains' ? 'off' : 'on'))).not.toContain(
      'Log drains'
    );
  });
});

it('includes Workflows in Automate and honors its capability', () => {
  expect(group('Automate')).toContain('Workflows');
  expect(APP_TAB_CAPABILITY.Workflows).toBe('workflows');
  expect(visibleAppTabs((id) => (id === 'workflows' ? 'off' : 'on'))).not.toContain('Workflows');
});

it('puts realtime with the other messaging pages under Automate, gated on its capability', () => {
  const names: readonly string[] = group('Automate') ?? [];
  expect(names.indexOf('Realtime')).toBe(names.indexOf('Queues') + 1);
  expect(APP_TAB_CAPABILITY.Realtime).toBe('realtime');
  expect(visibleAppTabs((id) => (id === 'realtime' ? 'off' : 'on'))).not.toContain('Realtime');
  expect(resolveAppTab('Realtime')).toBe('Realtime');
});

it('puts SLOs beside alerts under Observe, gated on custom-slos', () => {
  const names: readonly string[] = group('Observe') ?? [];
  expect(names.indexOf('SLOs')).toBe(names.indexOf('Alerts') + 1);
  expect(APP_TAB_CAPABILITY.SLOs).toBe('custom-slos');
  expect(visibleAppTabs((id) => (id === 'custom-slos' ? 'off' : 'on'))).not.toContain('SLOs');
  expect(visibleAppTabs(() => 'plan-not-entitled')).toContain('SLOs');
  expect(resolveAppTab('SLOs')).toBe('SLOs');
});

it('puts synthetic checks after SLOs under Observe, gated on their capability', () => {
  const names: readonly string[] = group('Observe') ?? [];
  expect(names.indexOf('Synthetic checks')).toBe(names.indexOf('SLOs') + 1);
  expect(APP_TAB_CAPABILITY['Synthetic checks']).toBe('synthetic-checks');
  expect(visibleAppTabs((id) => (id === 'synthetic-checks' ? 'off' : 'on'))).not.toContain(
    'Synthetic checks'
  );
  expect(visibleAppTabs(() => 'plan-not-entitled')).toContain('Synthetic checks');
  expect(resolveAppTab('Synthetic checks')).toBe('Synthetic checks');
});

it('puts the TCP and UDP listeners under Connect, each gated on its own capability', () => {
  const names: readonly string[] = group('Connect') ?? [];
  expect(names.indexOf('UDP listeners')).toBe(names.indexOf('TCP listeners') + 1);
  expect(APP_TAB_CAPABILITY['TCP listeners']).toBe('tcp-listeners');
  expect(APP_TAB_CAPABILITY['UDP listeners']).toBe('udp-listeners');
  const tabs = visibleAppTabs((id) => (id === 'udp-listeners' ? 'off' : 'on'));
  expect(tabs).toContain('TCP listeners');
  expect(tabs).not.toContain('UDP listeners');
});

it('preserves Release safety and hides it only when all of its capabilities are off', () => {
  expect(group('Delivery')).toEqual(['Deployments', 'Release safety', 'Activity']);
  const gated = APP_TAB_ANY_CAPABILITY['Release safety'] ?? [];
  expect(gated).toEqual(expect.arrayContaining(['deploy-freezes', 'scheduled-releases']));
  expect(visibleAppTabs((id) => (id === 'deploy-freezes' ? 'off' : 'on'))).toContain(
    'Release safety'
  );
  expect(visibleAppTabs((id) => (gated.includes(id) ? 'off' : 'on'))).not.toContain(
    'Release safety'
  );
});

it('keeps workflow schedules, insights and recovery in Automate with their capability gates', () => {
  for (const [tab, capability] of [
    ['Workflow schedules', 'workflow-schedules'],
    ['Workflow insights', 'workflow-insights'],
    ['Recovery policy', 'workflow-recovery'],
  ] as const) {
    expect(group('Automate')).toContain(tab);
    expect(APP_TAB_CAPABILITY[tab]).toBe(capability);
    expect(visibleAppTabs((id) => (id === capability ? 'off' : 'on'))).not.toContain(tab);
  }
});
