import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, NAV_ITEMS, visibleNavGroups, visibleNavItems } from './nav-config';

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
  it('drops a hidden section and keeps its hub while another section remains', () => {
    const data = visibleNavGroups(NAV_GROUPS, off('object-storage'))
      .flatMap((g) => g.items)
      .find((hub) => hub.label === 'Data');
    expect(data?.sections?.map((s) => s.label)).toEqual(['Postgres']);
  });
  it('hides a hub once every one of its sections is hidden', () => {
    const labels = hubLabels(
      visibleNavGroups(NAV_GROUPS, off('object-storage', 'managed-postgres'))
    );
    expect(labels).not.toContain('Data');
  });
  it('leaves everything when nothing is off', () => {
    expect(hubLabels(visibleNavGroups(NAV_GROUPS, off()))).toEqual(hubLabels(NAV_GROUPS));
  });
  it('filters the searchable items the palette lists the same way', () => {
    const labels = visibleNavItems(NAV_ITEMS, off('object-storage')).map((i) => i.label);
    expect(labels).not.toContain('Storage');
    expect(labels).toContain('Postgres');
  });
});
