import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { EdgeRule } from './queries';
import type { components } from './schema';

/**
 * Edge protection (faas ADR-829, ADR-20261021220456) and CORS preset edits
 * (ADR-129).
 *
 * The summary (`/edge-protection`) and pre-auth observations are read-only
 * Prometheus counts over a range; on a metrics failure `source` starts with
 * `degraded:` and every count is zero, which the panel must not read as "no
 * attacks". Attack mode is read from the app's rules, so it stays current
 * either way.
 */

export type EdgeProtection = components['schemas']['EdgeProtectionResponse'];
export type PreAuthObservations = components['schemas']['PreAuthObservationsResponse'];
export type AttackMode = components['schemas']['EdgeAttackModeStatus'];
export type EdgeRange = EdgeProtection['range'];
type UpdateCorsPreset = components['schemas']['UpdateCorsPresetRequest'];

export const EDGE_RANGES: readonly EdgeRange[] = ['5m', '15m', '1h', '6h', '24h', '7d', '15d'];

export const edgeProtectionKey = (slug: string) => ['apps', slug, 'edge-protection'] as const;
export const attackModeKey = (slug: string) => [...edgeProtectionKey(slug), 'attack-mode'] as const;

export function useEdgeProtection(slug: string, range: EdgeRange) {
  return useQuery({
    queryKey: [...edgeProtectionKey(slug), 'summary', range],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/edge-protection', {
          params: { path: { slug }, query: { range } },
          signal,
        })
      ),
    enabled: Boolean(slug),
  });
}

export function usePreAuthObservations(slug: string, range: EdgeRange) {
  return useQuery({
    queryKey: [...edgeProtectionKey(slug), 'pre-auth', range],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/pre-auth-observations', {
          params: { path: { slug }, query: { range } },
          signal,
        })
      ),
    enabled: Boolean(slug),
  });
}

/** Re-read attack mode only to see it end, and only when the end is close. */
const ATTACK_MODE_WATCH_MS = 15 * 60_000;

/**
 * The poll interval for attack mode: one re-read a second after its end when
 * that is within 15 minutes, otherwise none. TanStack evaluates this only
 * after the query updates, so `false` stops polling until something else
 * (a switch, a window focus) refreshes the answer.
 */
export function attackModeRefetch(data: AttackMode | undefined, now: number): number | false {
  if (!data?.active || !data.expires_at) return false;
  const left = Date.parse(data.expires_at) - now;
  if (Number.isNaN(left) || left > ATTACK_MODE_WATCH_MS) return false;
  return Math.max(left, 0) + 1_000;
}

export function useAttackMode(slug: string) {
  return useQuery({
    queryKey: attackModeKey(slug),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/edge-protection/attack-mode', {
          params: { path: { slug } },
          signal,
        })
      ),
    enabled: Boolean(slug),
    refetchInterval: (query) => attackModeRefetch(query.state.data, Date.now()),
  });
}

/** Every cache entry holding edge rules: the attack-mode rule shows in them. */
const edgeRulesPredicate = {
  predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey.includes('edge-rules'),
};

function useAttackModeSwitch<T>(slug: string, send: (arg: T) => Promise<AttackMode>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: (status) => {
      qc.setQueryData(attackModeKey(slug), status);
    },
    onSettled: (_data, error) => {
      // A 503 can mean the switch was saved but the fleet has not acknowledged
      // it, so after a failure the answer is read again rather than assumed.
      if (error) void qc.invalidateQueries({ queryKey: attackModeKey(slug) });
      void qc.invalidateQueries({ queryKey: edgeProtectionKey(slug) });
      void qc.invalidateQueries(edgeRulesPredicate);
    },
  });
}

/** Switch attack mode on for `seconds` from now, or move the end of an active one. */
export function useSwitchAttackModeOn(slug: string) {
  return useAttackModeSwitch(slug, (seconds: number) =>
    unwrap(
      api.PUT('/v1/apps/{slug}/edge-protection/attack-mode', {
        params: { path: { slug } },
        body: { duration_seconds: seconds },
      })
    )
  );
}

export function useSwitchAttackModeOff(slug: string) {
  return useAttackModeSwitch<void>(slug, () =>
    unwrap(
      api.DELETE('/v1/apps/{slug}/edge-protection/attack-mode', { params: { path: { slug } } })
    )
  );
}

/**
 * PATCH a CORS preset. Send only the fields that changed: apid checks the
 * plan's list caps only on the lists a PATCH replaces, so a rename never
 * trips a cap the preset predates (handlers_cors_presets.go:194-199).
 */
export function useUpdateCorsPreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCorsPreset }) =>
      unwrap(api.PATCH('/v1/cors-presets/{id}', { params: { path: { id } }, body })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cors-presets'] });
      void qc.invalidateQueries(edgeRulesPredicate);
    },
  });
}

/** The CORS rules that take their policy from the preset `id`. */
export function corsPresetUsers(rules: EdgeRule[] | undefined, id: string): EdgeRule[] {
  return (rules ?? []).filter(
    (rule) =>
      rule.kind === 'cors' &&
      (rule.action as { cors_preset_id?: string | null } | undefined)?.cors_preset_id === id
  );
}
