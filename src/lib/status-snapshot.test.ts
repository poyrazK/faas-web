import { afterEach, describe, expect, it } from 'vitest';
import type { PublicStatusOverview } from './api/status';
import { LAST_KNOWN_MAX_AGE_MS, readStatusSnapshot, saveStatusSnapshot } from './status-snapshot';

afterEach(() => window.localStorage.clear());

const snapshot = {
  overall_status: 'operational',
  data_status: 'fresh',
  updated_at: '2026-11-03T10:00:00Z',
  region_scope: 'single-region',
  components: [],
  indicators: [],
  active_events: [],
  upcoming_maintenance: [],
  resolved_incidents: [],
} as unknown as PublicStatusOverview;

const NOW = Date.parse('2026-11-03T12:00:00Z');

describe('the last known status', () => {
  it('returns what was saved', () => {
    saveStatusSnapshot(snapshot, NOW);
    expect(readStatusSnapshot(NOW + 60_000)).toEqual({
      savedAt: new Date(NOW).toISOString(),
      snapshot,
    });
  });

  it('is gone after a day', () => {
    saveStatusSnapshot(snapshot, NOW);
    expect(readStatusSnapshot(NOW + LAST_KNOWN_MAX_AGE_MS)).not.toBeNull();
    expect(readStatusSnapshot(NOW + LAST_KNOWN_MAX_AGE_MS + 1)).toBeNull();
  });

  it('refuses a stored value the page could not render', () => {
    expect(readStatusSnapshot(NOW)).toBeNull();
    window.localStorage.setItem('gregale.status.last-known', '{not json');
    expect(readStatusSnapshot(NOW)).toBeNull();
    const { resolved_incidents: _dropped, ...partial } = snapshot;
    window.localStorage.setItem(
      'gregale.status.last-known',
      JSON.stringify({ savedAt: new Date(NOW).toISOString(), snapshot: partial })
    );
    expect(readStatusSnapshot(NOW)).toBeNull();
  });
});
