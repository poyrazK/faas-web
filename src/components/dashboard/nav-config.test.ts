import { describe, expect, it } from 'vitest';
import {
  NAV_GROUPS,
  NAV_ITEMS,
  railGroupFor,
  visibleNavGroups,
  visibleNavItems,
} from './nav-config';

describe('railGroupFor', () => {
  it.each([
    ['/dashboard/projects', 'Projects', 'Compute'],
    ['/dashboard/instances', 'Instances', 'Compute'],
    ['/dashboard/builds', 'Builds', 'Compute'],
    ['/dashboard/postgres', 'Postgres', 'Storage'],
    ['/dashboard/edge-rules', 'Edge rules', 'Networking'],
    ['/dashboard/integrations', 'Integrations', 'Messaging'],
    ['/dashboard/customers', 'Customers', 'Monetize'],
    ['/dashboard/debug', 'Debugger', 'Observe'],
    ['/dashboard/invoices', 'Invoices', 'Account'],
    ['/dashboard/settings', 'Members', 'Account'],
  ])('files %s (%s) under %s', (to, label, heading) => {
    expect(railGroupFor({ to, label })).toBe(heading);
  });

  it.each([
    ['/dashboard', 'Overview'],
    ['/dashboard/apps', 'Apps'],
    ['/dashboard/logs', 'Logs'],
    ['/dashboard/templates', 'Templates'],
  ])('gives %s (%s) no heading', (to, label) => {
    expect(railGroupFor({ to, label })).toBeUndefined();
  });

  it('tells a Settings section apart from the hub of the same name', () => {
    expect(railGroupFor({ to: '/dashboard/settings', label: 'Integrations' })).toBe('Account');
    expect(railGroupFor({ to: '/dashboard/integrations', label: 'Integrations' })).toBe(
      'Messaging'
    );
  });
});

const off =
  (...ids: string[]) =>
  (id: string) =>
    ids.includes(id);
const hubLabels = (groups: ReturnType<typeof visibleNavGroups>) =>
  groups.flatMap((g) => g.items.map((hub) => hub.label));

describe('nav items gated on a capability', () => {
  it('hides a hub whose capability is off', () => {
    const labels = hubLabels(visibleNavGroups(NAV_GROUPS, off('events', 'platform-tenants')));
    expect(labels).not.toContain('Events');
    expect(labels).not.toContain('Customers');
    expect(labels).toContain('Domains');
  });
  it('hides Object storage and keeps Postgres under the Storage heading', () => {
    const storage = visibleNavGroups(NAV_GROUPS, off('object-storage')).find(
      (g) => g.title === 'Storage'
    );
    expect(storage?.items.map((hub) => hub.label)).toEqual(['Postgres']);
  });
  it('drops a heading once every hub under it is hidden', () => {
    const titles = visibleNavGroups(NAV_GROUPS, off('object-storage', 'managed-postgres')).map(
      (g) => g.title
    );
    expect(titles).not.toContain('Storage');
  });
  it('leaves everything when nothing is off', () => {
    expect(hubLabels(visibleNavGroups(NAV_GROUPS, off()))).toEqual(hubLabels(NAV_GROUPS));
  });
  it('filters the searchable items the palette lists the same way', () => {
    const labels = visibleNavItems(NAV_ITEMS, off('object-storage')).map((i) => i.label);
    expect(labels).not.toContain('Object storage');
    expect(labels).toContain('Postgres');
  });
});
