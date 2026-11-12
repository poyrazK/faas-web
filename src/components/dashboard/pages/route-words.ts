/**
 * An app's observed routes in plain words (docs/console-plain-english.md).
 *
 * Semantics, read from faas (api/openapi.yaml AppRoutesResponse,
 * pkg/apid/apidserver/observed_routes.go):
 * - Each label is `<METHOD> <PATH>`, recorded from requests at the gateway —
 *   never declared — or the reserved `__route_other__` overflow bucket.
 * - `source: unavailable` means the servers that record routes could not be
 *   read; it says nothing about the app. `partial` means some of them did
 *   not answer, so the list may miss routes.
 * - `cap_hit`: tracking reached its bound of 50 routes, so further routes are
 *   counted together in the overflow bucket.
 * - An app with `route_metrics_enabled: false` (always so on Free) lists no
 *   routes at all.
 */

export const OTHER_ROUTES = '__route_other__';

/** The fleet bound on distinct routes (AppRoutesResponse). */
export const ROUTE_CAP = 50;

export interface RouteLabel {
  /** The label exactly as the API sent it. */
  raw: string;
  method: string | null;
  path: string | null;
  /** The overflow bucket, not a real route. */
  other: boolean;
}

export function parseRoute(raw: string): RouteLabel {
  if (raw === OTHER_ROUTES || raw.endsWith(` ${OTHER_ROUTES}`))
    return { raw, method: null, path: null, other: true };
  const match = /^([A-Z]+) (\S.*)$/.exec(raw);
  if (match) return { raw, method: match[1], path: match[2], other: false };
  if (raw.startsWith('/')) return { raw, method: null, path: raw, other: false };
  return { raw, method: null, path: null, other: false };
}

/** "a", "a and b", "a, b and c". */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

export interface RoutesState {
  slug: string;
  /** `route_metrics_enabled` from the app; undefined while unknown. */
  tracking: boolean | undefined;
  source: string | undefined;
  /** Real routes, without the overflow bucket. */
  count: number;
  /** The overflow bucket is in the list. */
  other: boolean;
  capHit: boolean;
}

/** The tab's answer: what reaches the app, and whether the list is whole. */
export function routesSentence(s: RoutesState): {
  lead: string;
  rest: string;
  kind: 'off' | 'unavailable' | 'empty' | 'listed';
} {
  if (s.tracking === false)
    return {
      kind: 'off',
      lead: `Route tracking is off for ${s.slug}, so its routes aren’t listed.`,
      rest: 'Turn on per-route metrics in its runtime settings. It’s included on paid plans.',
    };
  if (s.source === 'unavailable')
    return {
      kind: 'unavailable',
      lead: `${s.slug}’s routes can’t be listed right now.`,
      rest: 'The servers that record routes didn’t answer. That isn’t a problem with your app.',
    };
  const notes: string[] = [];
  if (s.source === 'partial') notes.push('Some servers didn’t report, so a few may be missing.');
  if (s.capHit)
    notes.push(
      `Tracking stops at ${ROUTE_CAP} routes, so later ones are counted together as other routes.`
    );
  if (s.count === 0 && !s.other)
    return {
      kind: 'empty',
      lead: `No requests to ${s.slug} have been recorded recently.`,
      rest: [
        'Routes appear here as requests reach them; they come from traffic, not your code.',
        ...notes,
      ].join(' '),
    };
  const routes = `${s.count} ${s.count === 1 ? 'route' : 'routes'}`;
  return {
    kind: 'listed',
    lead:
      s.count === 0
        ? `Requests reached ${s.slug}, counted together as other routes.`
        : `${routes} on ${s.slug} ${s.count === 1 ? 'has' : 'have'} had traffic.`,
    rest: notes.join(' '),
  };
}
