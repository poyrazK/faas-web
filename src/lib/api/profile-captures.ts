import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { keys, retryPolicy } from './queries';

/**
 * On-demand profile captures (capability `profile-captures`, faas ADR-1155,
 * docs/profiling.md "Capture a running instance on demand").
 *
 * A capture profiles one RUNNING instance for 1–60 seconds — CPU, heap,
 * stacks, and Go block and mutex contention — and is kept 7 days
 * (api.ProfileCaptureRetention, pkg/api/limits.go:939). Gregale also starts
 * captures on its own when memory runs low, a request is stuck, or an instance
 * uses its whole CPU limit. The view and diff are the API's merged functions
 * and call-path tree; the pprof download is the API's own gzip file.
 */

export type ProfileCapture = components['schemas']['ProfileCapture'];
export type ProfileKind = ProfileCapture['kinds'][number];
export type ProfileCaptureView = components['schemas']['ProfileCaptureView'];
export type ProfileCaptureDiff = components['schemas']['ProfileCaptureDiff'];
export type ProfileStack = components['schemas']['ProfileCaptureStack'];
export type ProfileStackDelta = components['schemas']['ProfileCaptureStackDelta'];
export type CreateProfileCapture = components['schemas']['CreateProfileCaptureRequest'];

/** api.ProfileCaptureMinDuration / DefaultDuration / MaxDuration. */
export const CAPTURE_DURATION = { min: 1, default: 10, max: 60 } as const;

const SETTLING: ReadonlySet<ProfileCapture['status']> = new Set(['queued', 'capturing']);
export const profileCapturesKey = (slug: string) => ['apps', slug, 'profile-captures'] as const;

export function useProfileCaptures(slug: string) {
  return useQuery({
    queryKey: profileCapturesKey(slug),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/profiles/captures', { params: { path: { slug } }, signal })),
    enabled: Boolean(slug),
    retry: retryPolicy,
    refetchInterval: (query) =>
      query.state.data?.captures.some((c) => SETTLING.has(c.status)) ? 2_000 : false,
  });
}

export function useProfileCapture(slug: string, id: string) {
  return useQuery({
    queryKey: [...profileCapturesKey(slug), id],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/profiles/captures/{id}', {
          params: { path: { slug, id } },
          signal,
        })
      ),
    enabled: Boolean(slug && id),
    retry: retryPolicy,
    refetchInterval: (query) =>
      query.state.data && SETTLING.has(query.state.data.status) ? 2_000 : false,
  });
}

export function useCreateProfileCapture(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProfileCapture) =>
      unwrap(api.POST('/v1/apps/{slug}/profiles/captures', { params: { path: { slug } }, body })),
    onSettled: () => qc.invalidateQueries({ queryKey: profileCapturesKey(slug) }),
  });
}

/** Deletes the capture and its profiles now; a queued or running one is cancelled. */
export function useDeleteProfileCapture(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.DELETE('/v1/apps/{slug}/profiles/captures/{id}', { params: { path: { slug, id } } })
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: profileCapturesKey(slug) }),
  });
}

/** One kind merged across the instance's processes; read only once the capture is ready. */
export function useProfileCaptureView(slug: string, id: string, kind: ProfileKind | undefined) {
  return useQuery({
    queryKey: [...profileCapturesKey(slug), id, 'view', kind],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/profiles/captures/{id}/view', {
          params: { path: { slug, id }, query: kind ? { kind } : {} },
          signal,
        })
      ),
    enabled: Boolean(slug && id && kind),
    retry: retryPolicy,
    staleTime: 5 * 60_000,
  });
}

export function useProfileCaptureDiff(
  slug: string,
  id: string,
  base: string | undefined,
  kind: ProfileKind | undefined
) {
  return useQuery({
    queryKey: [...profileCapturesKey(slug), id, 'diff', base, kind],
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/profiles/captures/{id}/diff', {
          params: { path: { slug, id }, query: { base: base!, ...(kind ? { kind } : {}) } },
          signal,
        })
      ),
    enabled: Boolean(slug && id && base),
    retry: retryPolicy,
    staleTime: 5 * 60_000,
  });
}

/** apid's `attachment; filename="…"`, or the name apid gives it (profilecapture/view.go:134). */
function attachmentName(header: string | null, fallback: string): string {
  const match = header?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  return match?.[1]?.trim() || fallback;
}

/**
 * One kind as the merged gzip pprof the API builds. The file is the response
 * body as sent; the console adds nothing and draws nothing from it.
 */
export async function downloadProfileCapture(
  slug: string,
  id: string,
  kind: ProfileKind
): Promise<{ blob: Blob; filename: string }> {
  const result = await api.GET('/v1/apps/{slug}/profiles/captures/{id}/pprof', {
    params: { path: { slug, id }, query: { kind } },
    parseAs: 'blob',
  });
  const blob = (await unwrap(Promise.resolve(result))) as Blob;
  return {
    blob,
    filename: attachmentName(
      result.response.headers.get('Content-Disposition'),
      `profile-${id}-${kind}.pb.gz`
    ),
  };
}

type Profiling = components['schemas']['ProfilingConfig'];

/** Whether the platform may start captures of this app on its own; unset means on (api/profiles.go:57-61). */
export function automaticCapturesOn(profiling: Profiling | undefined): boolean {
  return profiling?.automatic_captures !== false;
}

/** Guest-init's own loopback listeners, which a pprof port may not name (api.ProfilePprofReservedPorts). */
export const RESERVED_PPROF_PORTS: readonly number[] = [9191, 4318];

/**
 * Saves the capture settings in the app's profiling object: automatic
 * captures and the Go pprof port. `profiling` is replaced whole on PATCH
 * (faas lifecycle.go:251-254), so the rest of it is sent back as read; a
 * missing object is the default, continuous profiling off.
 */
export function useSaveCaptureSettings(slug: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      current,
      patch,
    }: {
      current: Profiling | undefined;
      patch: Pick<Profiling, 'automatic_captures' | 'pprof_port'>;
    }) => {
      const next: Profiling = { ...(current ?? { enabled: false }), ...patch };
      if (next.pprof_port === undefined) delete next.pprof_port;
      return unwrap(
        api.PATCH('/v1/apps/{slug}', { params: { path: { slug } }, body: { profiling: next } })
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.app(slug) });
      void qc.invalidateQueries({ queryKey: keys.apps });
    },
  });
}
