import type { components } from '../src/lib/api/schema';
import * as db from './data';

type S = components['schemas'];
type Learned = S['ServiceWakeAheadLearned'];
type Edge = Omit<S['ServiceWakeAheadTarget'], 'app_id' | 'slug'>;

/**
 * Service wake-ahead (faas ADR-977). Seeded apps carry no service policy, so
 * `api-gateway` stands in for a project service under the `project` policy:
 * on by default (ADR-20261025105812). `webhook-router` starts with an explicit
 * off. Keyed by app id so a rename keeps the choice.
 */
const DEFAULT_ON = new Set(['api-gateway']);
const choices = new Map<string, { enabled: boolean; updated_at: string }>(
  db.apps
    .filter((a) => a.slug === 'webhook-router')
    .map((a) => [a.id, { enabled: false, updated_at: db.iso(2 * 24 * 3600000) }])
);

/** What the gateways measured, per caller slug. Unlisted apps have no edges yet. */
const MEASURED: Record<string, { wakes: number; edges: Record<string, Edge> }> = {
  'api-gateway': {
    wakes: 46,
    edges: {
      'image-resize': {
        call_share: 0.82,
        cold_share: 0.64,
        qualifies: true,
        started: 31,
        used: 28,
        unused: 2,
        failed: 1,
      },
      'webhook-router': {
        call_share: 0.3,
        cold_share: 0.9,
        qualifies: false,
        started: 0,
        used: 0,
        unused: 0,
        failed: 0,
      },
    },
  },
  'nightly-etl': { wakes: 3, edges: {} },
};

function learned(app: db.App): Learned {
  // billing-recon is the failing app: its gateway metrics cannot be read.
  if (app.slug === 'billing-recon')
    return { source: 'unavailable', window: '24h', caller_wakes: 0, targets: [] };
  const measured = app.preview_of_slug ? undefined : MEASURED[app.slug];
  const targets = Object.entries(measured?.edges ?? {}).flatMap(([slug, edge]) => {
    // Targets outside the account are never shown (routeevidence/reader.go).
    const peer = db.apps.find((a) => a.slug === slug);
    return peer ? [{ app_id: peer.id, slug, ...edge }] : [];
  });
  return { source: 'live', window: '24h', caller_wakes: measured?.wakes ?? 0, targets };
}

export function readWakeAhead(app: db.App): S['ServiceWakeAheadResponse'] {
  const choice = choices.get(app.id);
  return {
    slug: app.slug,
    enabled: choice ? choice.enabled : DEFAULT_ON.has(app.slug) && !app.preview_of_slug,
    ...(choice ? { updated_at: choice.updated_at } : {}),
    learned: learned(app),
  };
}

/** The PUT: undefined for a body the handler would 400; no learned block. */
export function writeWakeAhead(
  app: db.App,
  enabled: unknown
): S['ServiceWakeAheadResponse'] | undefined {
  if (typeof enabled !== 'boolean') return undefined;
  const choice = { enabled, updated_at: new Date().toISOString() };
  choices.set(app.id, choice);
  return { slug: app.slug, ...choice };
}
