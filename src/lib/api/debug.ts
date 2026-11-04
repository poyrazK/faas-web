import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { retryPolicy } from './queries';

/*
 * The debugger's reads and writes beyond the request list (faas ADR-127).
 *
 * Two capabilities own these routes (faas pkg/productcap/catalog.json): the
 * beta `debug` family — coverage, running, dependencies and regressions with
 * their review and checked actions — which every account has, and the
 * `production-debugger` preview — status, the request list, export, evidence,
 * replay and compare — which callers gate before reading. Every route is also
 * plan-gated (`DebugTelemetryEnabled`, 402 `plan_feature_gated` on Free).
 */

export type DebugStatus = components['schemas']['DebugStatusResponse'];
export type DebugCoverage = components['schemas']['DebugCoverageResponse'];
export type DebugRunning = components['schemas']['DebugRunningResponse'];
export type DebugRegressionReview = components['schemas']['DebugRegressionReview'];
export type DebugRegressionAction =
  components['schemas']['GuardedDebugRegressionActionRequest']['action'];
export type DebugReplay = components['schemas']['DebugReplayResponse'];
export type DebugExportFormat = 'ndjson' | 'csv';

const debugKey = (slug: string) => ['apps', slug, 'debug'] as const;

/** One answer to "is this app healthy, and where do I look?" (production-debugger). */
export function useDebugStatus(slug: string, since: string) {
  return useQuery({
    queryKey: [...debugKey(slug), 'status', since],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/debug/status', {
          params: { path: { slug }, query: { since } },
          signal,
        })
      ),
    enabled: Boolean(slug),
    retry: retryPolicy,
  });
}

/** How much of the retained telemetry carries each debugger signal. */
export function useDebugCoverage(slug: string, since: string) {
  return useQuery({
    queryKey: [...debugKey(slug), 'coverage', since],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/debug/coverage', {
          params: { path: { slug }, query: { since } },
          signal,
        })
      ),
    enabled: Boolean(slug),
    retry: retryPolicy,
  });
}

/** Observed scheduler causes that kept the app resident. */
export function useDebugRunning(slug: string, since: string) {
  return useQuery({
    queryKey: [...debugKey(slug), 'running', since],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/debug/running', {
          params: { path: { slug }, query: { since, limit: 20 } },
          signal,
        })
      ),
    enabled: Boolean(slug),
    retry: retryPolicy,
  });
}

/**
 * The exact, versioned triage record behind one regression. The version
 * changes on every write, detector refreshes included, so a checked action
 * names the version it was decided against.
 */
export function useDebugRegressionReview(slug: string, deploymentId: string, route: string) {
  return useQuery({
    queryKey: [...debugKey(slug), 'regressions', 'review', deploymentId, route],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/debug/regressions/review', {
          params: { path: { slug }, query: { deployment_id: deploymentId, route } },
          signal,
        })
      ),
    enabled: Boolean(slug && deploymentId && route),
    retry: retryPolicy,
  });
}

/**
 * Acknowledge, dismiss, resolve or reopen through the checked endpoint: it
 * refuses with 409 `regression_changed` when the observation moved since the
 * review was read. Triage changes metadata only, never traffic.
 */
export function useDebugRegressionAction(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: components['schemas']['GuardedDebugRegressionActionRequest']) =>
      unwrap(
        api.POST('/v1/apps/{slug}/debug/regressions/actions', {
          params: { path: { slug } },
          body,
        })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: [...debugKey(slug), 'regressions'] }),
  });
}

/**
 * Reissue a retained request through the enabled mirror rule of the
 * deployment that served it. It sends real traffic to the mirror target, with
 * an empty body and no credentials (none are retained); 409
 * `debug_replay_unsupported` when no mirror rule targets that deployment.
 */
export function useDebugReplay(slug: string) {
  return useMutation({
    mutationFn: (reqId: string) =>
      unwrap(
        api.POST('/v1/apps/{slug}/debug/requests/{req_id}/replay', {
          params: { path: { slug, req_id: reqId } },
          body: {},
        })
      ),
  });
}

export interface DebugExport {
  blob: Blob;
  filename: string;
  /** `X-Faas-Request-Log-Window`: the lookback actually applied. */
  window: string | null;
  /** `X-Faas-Request-Log-Retention-Clamped`: the plan cut the window short. */
  clamped: boolean;
}

/** A Go duration as apid prints it ("72h0m0s") without its empty units ("72h"). */
export function tidyDuration(value: string | null): string | null {
  if (!value) return value;
  const tidy = value.replace(/(\d)m0s$/, '$1m').replace(/(\d)h0m$/, '$1h');
  return tidy === '0s' ? value : tidy;
}

/** apid's `attachment; filename="…"`, or a fallback named like it. */
function attachmentName(header: string | null, fallback: string): string {
  const match = header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match?.[1]?.trim() || fallback;
}

/**
 * The metadata-only request log apid builds (`ndjson` or `csv`, at most
 * 10,000 rows, no bodies, headers or source IPs). The file is the response
 * body as sent; the console adds nothing to it.
 */
export async function exportDebugRequests(
  slug: string,
  options: { since: string; format: DebugExportFormat }
): Promise<DebugExport> {
  const result = await api.GET('/v1/apps/{slug}/debug/requests/export', {
    params: { path: { slug }, query: { since: options.since, format: options.format } },
    parseAs: 'blob',
  });
  const blob = (await unwrap(Promise.resolve(result))) as Blob;
  const headers = result.response.headers;
  return {
    blob,
    filename: attachmentName(
      headers.get('Content-Disposition'),
      `${slug}-requests.${options.format}`
    ),
    window: tidyDuration(headers.get('X-Faas-Request-Log-Window')),
    clamped: headers.get('X-Faas-Request-Log-Retention-Clamped') === 'true',
  };
}
