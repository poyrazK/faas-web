import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadNav(canvas: boolean) {
  vi.resetModules();
  vi.doMock('@/lib/feature-flags', () => ({ featureFlags: { example: false, canvas } }));
  return import('./nav-config');
}

afterEach(() => vi.doUnmock('@/lib/feature-flags'));

describe('canvas navigation', () => {
  it('is absent from the rail and the palette when the flag is off', async () => {
    const nav = await loadNav(false);
    expect(nav.NAV_HUBS.some((h) => h.to === '/dashboard/canvas')).toBe(false);
    expect(nav.NAV_GROUPS.flatMap((g) => g.items).some((h) => h.label === 'Canvas')).toBe(false);
  });

  it('sits directly under Overview when the flag is on', async () => {
    const nav = await loadNav(true);
    const lead = nav.NAV_GROUPS[0].items.map((h) => h.label);
    expect(lead).toEqual(['Overview', 'Canvas']);
    expect(nav.SECTION_LABELS.canvas).toBe('Canvas');
  });

  it('marks only the canvas as full-bleed', async () => {
    const nav = await loadNav(true);
    expect(nav.isFullBleedPath('/dashboard/canvas')).toBe(true);
    expect(nav.isFullBleedPath('/dashboard/canvas/')).toBe(true);
    expect(nav.isFullBleedPath('/dashboard/domains')).toBe(false);
  });
});
