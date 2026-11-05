import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { keys, retryPolicy } from './queries';

/**
 * Release gates on customer signals (faas ADR-20261019071734,
 * ADR-20261022082305, apidserver/release_gates.go): the canary judges each
 * gate on every tick and the post-release watch for 30 minutes after 100%; a
 * failed gate aborts the canary (abort_release_gate) or rolls the release
 * back (abort_post_release_gate). A gate without enough samples is not judged
 * and never holds a rollout.
 */
export type ReleaseGate = components['schemas']['ReleaseGate'];
export type CreateReleaseGate = components['schemas']['CreateReleaseGateRequest'];
export type GateKind = ReleaseGate['kind'];

/** api.ReleaseGatesPerAppMax and the name pattern (pkg/api/limits.go:1330, release_gates.go). */
export const GATES_PER_APP = 10;
export const GATE_NAME = /^[a-z][a-z0-9_-]{0,62}$/;
export const AI_METRICS = ['error_rate', 'flagged_rate', 'cost_per_call', 'ttfb_ms'] as const;

export const GATE_KINDS: { key: GateKind; label: string; line: string }[] = [
  {
    key: 'slo',
    label: 'SLO',
    line: 'Fails when the release burns one of the app’s SLOs too fast, and is worse than the release it replaces.',
  },
  {
    key: 'new_errors',
    label: 'New errors',
    line: 'Fails when the release produces error groups that never happened before.',
  },
  {
    key: 'custom_metric',
    label: 'Metric bound',
    line: 'Fails when a custom metric’s average crosses a bound. Most useful once the release takes all traffic.',
  },
  {
    key: 'metric_change',
    label: 'Metric change',
    line: 'Fails when a custom metric moves too far from its average before the rollout.',
  },
  {
    key: 'synthetic',
    label: 'Synthetic check',
    line: 'Probes the canary and the stable release once a minute; fails when the canary fails more than both a threshold and the stable release.',
  },
  {
    key: 'ai',
    label: 'AI calls',
    line: 'Fails when the release’s AI gateway calls get worse than the previous release’s.',
  },
];

/** One line saying what a gate fails on, from the API's own fields. */
export function gateRule(gate: ReleaseGate): string {
  switch (gate.kind) {
    case 'slo':
      return `SLO ${gate.slo ?? '?'} burning faster than ${gate.max_burn_rate ?? 10}×`;
    case 'new_errors':
      return `More than ${gate.max_new_groups ?? 0} new error group(s) with ${gate.min_events ?? 3}+ events`;
    case 'custom_metric':
      return `${gate.metric} average ${gate.comparison === 'below' ? 'below' : 'above'} ${gate.threshold}`;
    case 'metric_change':
      return `${gate.metric} ${gate.comparison === 'below' ? 'drops' : 'rises'} more than ${gate.max_change_percent}% from before the rollout`;
    case 'synthetic':
      return `Check ${gate.check ?? '?'} failing more than ${gate.max_failure_percent ?? 10}% of probes, and more than stable`;
    case 'ai':
      return `AI ${gate.metric} more than ${gate.max_increase_percent ?? 50}% worse than the previous release`;
  }
}

const gatesKey = (slug: string) => [...keys.app(slug), 'release-gates'] as const;

export function useReleaseGates(slug: string, enabled = true) {
  return useQuery({
    queryKey: gatesKey(slug),
    queryFn: async ({ signal }) =>
      (
        await unwrap(
          api.GET('/v1/apps/{slug}/release-gates', { params: { path: { slug } }, signal })
        )
      ).gates,
    enabled: enabled && Boolean(slug),
    retry: retryPolicy,
  });
}

export function useCreateReleaseGate(slug: string) {
  const cache = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (body: CreateReleaseGate) =>
      unwrap(api.POST('/v1/apps/{slug}/release-gates', { params: { path: { slug } }, body })),
    onSettled: () => cache.invalidateQueries({ queryKey: gatesKey(slug) }),
  });
}

export function useDeleteReleaseGate(slug: string) {
  const cache = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: (name: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/release-gates/{name}', { params: { path: { slug, name } } })
      ),
    onSettled: () => cache.invalidateQueries({ queryKey: gatesKey(slug) }),
  });
}
