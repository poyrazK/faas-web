import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { GuardProblem } from './release-freezes';

type S = components['schemas'];
type Gate = S['RouteHealthGate'];

/**
 * The critical-route guard (faas handlers_route_health.go:25-63,
 * pkg/routehealth/health.go:16-52). The first app's guard matches the
 * enforce-mode report its canary already shows.
 */
export const gates = new Map<string, Gate>(
  db.EMPTY
    ? []
    : [
        [
          db.apps[0].slug,
          {
            app_id: db.apps[0].id,
            mode: 'enforce',
            on_regression: 'hold',
            revision: 3,
            routes: [
              { method: 'POST', path: '/v1/orders' },
              {
                method: 'GET',
                path: '/v1/orders/{id}',
                check_latency: true,
                probe: { path: '/v1/orders/1' },
              },
            ],
            updated_at: db.iso(2 * 86_400_000),
          },
        ],
      ]
);

/** GET: report mode, no routes and revision 0 until the first save. */
export function get(slug: string, appId: string): Gate {
  return gates.get(slug) ?? { app_id: appId, mode: 'report', revision: 0, routes: [] };
}

const invalid = (detail: string) => new GuardProblem(400, 'validation_failed', detail);

/** PUT: routehealth.Validate, then the revision check. */
export function set(
  slug: string,
  appId: string,
  body: Partial<S['SetRouteHealthGateRequest']>
): Gate {
  const { mode, expected_revision: expected, routes, on_regression: recovery } = body;
  if (recovery !== undefined && recovery !== 'hold' && recovery !== 'abort')
    throw invalid('on_regression must be hold or abort');
  if (
    (mode !== 'report' && mode !== 'enforce') ||
    typeof expected !== 'number' ||
    !Array.isArray(routes) ||
    routes.length > 20 ||
    (mode === 'enforce' && routes.length === 0)
  )
    throw invalid(
      'supply report/enforce, expected_revision, and a routes array of at most 20 entries; enforcement requires routes'
    );
  const seen = new Set<string>();
  let probes = 0;
  for (const r of routes) {
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(r.method))
      throw invalid('unsupported route method');
    const key = `${r.method} ${r.path}`;
    if (
      !r.path?.startsWith('/') ||
      /[?#*\\\s]/.test(r.path) ||
      r.path.length > 240 ||
      seen.has(key)
    )
      throw invalid(
        'routes must be distinct exact normalized telemetry paths without queries or wildcards'
      );
    if (r.max_p95_ms !== undefined && (r.max_p95_ms < 0 || r.max_p95_ms > 86_400_000))
      throw invalid('max_p95_ms must be between 0 (disabled) and 86400000');
    if (r.probe) {
      if (r.method !== 'GET' && r.method !== 'HEAD')
        throw invalid('only GET and HEAD selectors can be probed');
      probes++;
    }
    seen.add(key);
  }
  if (probes > 5) throw invalid('at most 5 routes can enable synthetic probes');
  const current = get(slug, appId);
  if (expected !== current.revision)
    throw new GuardProblem(409, 'conflict', 'Read the current revision before updating the guard.');
  const onRegression = recovery ?? 'hold';
  const same =
    current.mode === mode &&
    (current.on_regression ?? 'hold') === onRegression &&
    JSON.stringify(current.routes) === JSON.stringify(routes);
  const saved: Gate = same
    ? current
    : {
        app_id: appId,
        mode,
        on_regression: onRegression,
        revision: current.revision + 1,
        routes,
        updated_at: new Date().toISOString(),
      };
  gates.set(slug, saved);
  const warnings =
    onRegression === 'abort'
      ? [
          'on_regression abort: no Safe Deploy worker holds the rollout lease now; until one does, a confirmed regression holds the canary.',
        ]
      : [];
  return warnings.length ? { ...saved, warnings } : saved;
}
