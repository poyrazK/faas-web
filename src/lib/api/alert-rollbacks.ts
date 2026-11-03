import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

/**
 * Alert-triggered rollbacks (faas handlers_alert_rollbacks.go,
 * alert_rollback_window.go): a production alert rule with action `rollback`
 * that fires during a canary pins that canary and its serving predecessor and
 * restores the predecessor; with `post_deploy_rollback_window_seconds` it can
 * also roll a completed release back shortly after cutover. Each fire leaves a
 * durable receipt; the API keeps the 32 most recently updated per app.
 */
export type AlertRollback = components['schemas']['AlertRollback'];

/** api.AlertRollbackMaxWindowSeconds (faas pkg/api/limits.go:1258). */
export const ROLLBACK_WINDOW_MAX_SECONDS = 3600;

export const ROLLBACK_STATUS: Record<AlertRollback['status'], string> = {
  pending: 'Rolling back',
  blocked: 'Blocked, will retry',
  complete: 'Rolled back',
  failed: 'Not rolled back',
};

/**
 * Metrics whose rules may only notify (faas pkg/api/alerts.go:362-375,
 * AlertRuleActionAllowedForMetric): events, MCP, workflows, edge security and
 * edge rules, custom and log-search metrics, queues and route alerts.
 */
export function rollbackAllowedFor(metric: string): boolean {
  if (/^(event_|mcp_|workflow_|edge_rule_|pre_auth_)/.test(metric)) return false;
  return ![
    'edge_validation_failures',
    'edge_rejections',
    'edge_waf_detections',
    'custom_metric',
    'log_search_matches',
    'queue_backlog',
    'queue_oldest_age_seconds',
    'route_insights_detected',
    'route_monitor_incidents',
    'route_health_holds',
  ].includes(metric);
}

/**
 * A completed release can be rolled back only on its own 5xx rate: an
 * error_rate_pct rule compared with gt or gte (HistoricalAlertRollbackSupported,
 * faas pkg/state/alert_historical_evidence.go:79-82).
 */
export const postDeployWindowAllowed = (metric: string, comparison: string) =>
  metric === 'error_rate_pct' && (comparison === 'gt' || comparison === 'gte');

const key = (slug: string) => ['apps', slug, 'alert-rollbacks'] as const;
const inFlight = (r: AlertRollback) => r.status === 'pending' || r.status === 'blocked';

/** The app's recent automatic rollbacks, newest update first. */
export function useAlertRollbacks(slug: string, enabled = true) {
  return useQuery({
    queryKey: key(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/alert-rollbacks', { params: { path: { slug } }, signal })),
    enabled: enabled && Boolean(slug),
    retry: retryPolicy,
    refetchInterval: (query) => (query.state.data?.some(inFlight) ? 10_000 : false),
  });
}

/** One fire's rollback receipt, refreshed while it is still in flight. */
export function useAlertRollback(slug: string, fire: string, enabled = true) {
  return useQuery({
    queryKey: [...key(slug), fire],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/alert-rollbacks/{fire}', {
          params: { path: { slug, fire } },
          signal,
        })
      ),
    enabled: enabled && Boolean(slug && fire),
    retry: retryPolicy,
    refetchInterval: (query) => (query.state.data && inFlight(query.state.data) ? 5_000 : false),
  });
}
