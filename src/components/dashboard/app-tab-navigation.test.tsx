import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  APP_TAB_CAPABILITY,
  AppTabNavigation,
  resolveAppTab,
  visibleAppTabs,
  type AppTab,
} from './app-tab-navigation';

function Navigation({ initial }: { initial: AppTab }) {
  const [tab, select] = useState(initial);
  return <AppTabNavigation tab={tab} onSelect={select} panelId="panel" />;
}

const pages = (group: string) => screen.getByRole('group', { name: `${group} pages` });

it('opens the right group from a deep linked page', () => {
  render(<Navigation initial="Edge rules" />);
  expect(screen.getByRole('tab', { name: 'Connect' })).toHaveAttribute('aria-selected', 'true');
  expect(within(pages('Connect')).getByRole('button', { name: 'Edge rules' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(screen.getAllByRole('tab')).toHaveLength(7);
});

it('moves between groups with the arrow keys and lands on the first page', async () => {
  render(<Navigation initial="Configuration" />);
  screen.getByRole('tab', { name: 'Configure' }).focus();
  await userEvent.keyboard('{ArrowLeft}');
  expect(screen.getByRole('tab', { name: 'Automate' })).toHaveFocus();
  expect(screen.getByRole('tab', { name: 'Automate' })).toHaveAttribute('aria-selected', 'true');
  expect(within(pages('Automate')).getByRole('button', { name: 'Automations' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await userEvent.keyboard('{Home}');
  expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
});

it('remembers the page last open in each group', async () => {
  render(<Navigation initial="Edge rules" />);
  await userEvent.click(within(pages('Connect')).getByRole('button', { name: 'Mirrors' }));
  await userEvent.click(screen.getByRole('tab', { name: 'Automate' }));
  expect(within(pages('Automate')).getAllByRole('button')).toHaveLength(3);
  await userEvent.click(screen.getByRole('tab', { name: 'Connect' }));
  expect(within(pages('Connect')).getByRole('button', { name: 'Mirrors' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

it('offers env vars and secrets as one Environment page', () => {
  render(<Navigation initial="Environment" />);
  expect(
    within(pages('Configure'))
      .getAllByRole('button')
      .map((b) => b.textContent)
  ).toEqual(['Environment', 'Configuration']);
});

it('resolves retired tab names so old links still land', () => {
  expect(resolveAppTab('Secrets')).toBe('Environment');
  expect(resolveAppTab('Env vars')).toBe('Environment');
  expect(resolveAppTab('Logs')).toBe('Logs');
  expect(resolveAppTab('nope')).toBeUndefined();
  expect(resolveAppTab(3)).toBeUndefined();
});

it('groups the consumer pages under Monetize', () => {
  render(<Navigation initial="Consumer plans" />);
  expect(screen.getByRole('tab', { name: 'Monetize' })).toHaveAttribute('aria-selected', 'true');
  expect(
    within(pages('Monetize'))
      .getAllByRole('button')
      .map((b) => b.textContent)
  ).toEqual(['Consumers', 'Consumer plans']);
});

it('puts Outbound integrations under Connect, beside the app’s other destinations', () => {
  render(<Navigation initial="Outbound" />);
  expect(screen.getByRole('tab', { name: 'Connect' })).toHaveAttribute('aria-selected', 'true');
  expect(within(pages('Connect')).getByRole('button', { name: 'Outbound' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(resolveAppTab('Outbound')).toBe('Outbound');
});

it('puts the request audit with the other Observe pages', () => {
  render(<Navigation initial="Request audit" />);
  expect(screen.getByRole('tab', { name: 'Observe' })).toHaveAttribute('aria-selected', 'true');
  expect(
    within(pages('Observe'))
      .getAllByRole('button')
      .map((b) => b.textContent)
  ).toEqual(['Logs', 'Log drains', 'Errors', 'Issues', 'Alerts', 'Debugger', 'Request audit']);
  expect(resolveAppTab('Request audit')).toBe('Request audit');
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

describe('AppTabNavigation with hidden tabs', () => {
  it('drops hidden pages from their group and groups left empty', () => {
    const visible = visibleAppTabs((id) =>
      ['api-consumers', 'api-monetization', 'traffic-mirroring'].includes(id) ? 'off' : 'on'
    );
    render(<AppTabNavigation tab="Routes" onSelect={() => {}} panelId="p" visible={visible} />);
    expect(screen.queryByRole('tab', { name: 'Monetize' })).toBeNull();
    const connect = screen.getByRole('group', { name: 'Connect pages' });
    expect(within(connect).queryByRole('button', { name: 'Mirrors' })).toBeNull();
    expect(within(connect).getByRole('button', { name: 'Routes' })).toBeInTheDocument();
  });
});

it('puts edge protection beside edge rules, gated on its capability', () => {
  render(<Navigation initial="Edge rules" />);
  const names = within(pages('Connect'))
    .getAllByRole('button')
    .map((b) => b.textContent);
  expect(names.indexOf('Edge protection')).toBe(names.indexOf('Edge rules') + 1);
  expect(APP_TAB_CAPABILITY['Edge protection']).toBe('edge-protection');
  expect(visibleAppTabs((id) => (id === 'edge-protection' ? 'off' : 'on'))).not.toContain(
    'Edge protection'
  );
});
