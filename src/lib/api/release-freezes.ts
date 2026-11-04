import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap } from './client';
import type { components } from './schema';
import { keys, retryPolicy } from './queries';

/**
 * Deploy freezes and release windows (faas ADR-20261019071733,
 * apidserver/release_freezes.go, release_freezes_org.go). A freeze withholds
 * new production releases of one app, or of every app of its owner, while it
 * is active. An account's freezes cover its personal apps; a company
 * organization owns the freezes of its apps, whoever created them (amendment
 * 4), so a company app's freezes are read and written through the app or the
 * organization, never `/v1/freezes`.
 */
export type ReleaseFreeze = components['schemas']['ReleaseFreeze'];
export type ReleaseFreezeStatus = components['schemas']['ReleaseFreezeStatus'];
export type CreateReleaseFreeze = components['schemas']['CreateReleaseFreezeRequest'];
export type FreezeKind = ReleaseFreeze['kind'];
export type Weekday = components['schemas']['ReleaseFreezeWeekly']['days'][number];

/** Where a freeze is listed and created: one app, the account's apps, or an organization's. */
export type FreezeOwner =
  { kind: 'app'; slug: string } | { kind: 'account' } | { kind: 'org'; org: string };

/** apid's limits (faas pkg/api/limits.go:1317-1320, release_freezes.go). */
export const FREEZE_REASON_MAX = 200;
export const FREEZE_WEEKLY_MAX_MINUTES = 7 * 24 * 60;
export const FREEZE_AFTER_ROLLBACK_MAX_MINUTES = 24 * 60;
export const WEEKDAYS: readonly Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * What a freeze refuses and what it never touches, from faas
 * docs/deploys.md#deploy-freezes: every way of releasing to production is
 * refused with `release_frozen`; rollbacks, rollouts already under way,
 * previews, other environments and env changes go through.
 */
export const FREEZE_BLOCKS =
  'New production releases are refused: deploys, GitHub pushes, retries and promotions into production.';
export const FREEZE_SPARES =
  'Rollbacks, rollouts already under way, previews, other environments and env or secret changes still go through.';

/** "Covers …": the apps a freeze withholds. */
export function freezeCoverage(freeze: Pick<ReleaseFreeze, 'app' | 'org'>): string {
  if (freeze.app) return freeze.app;
  if (freeze.org) return `every app of ${freeze.org}`;
  return 'every personal app of your account';
}

/** Who a new freeze for `owner` blocks, as one sentence for its confirmation. */
export function ownerCoverage(owner: FreezeOwner): string {
  switch (owner.kind) {
    case 'app':
      return `production releases of ${owner.slug}`;
    case 'org':
      return `production releases of every app of the organization ${owner.org}, whoever created it`;
    case 'account':
      return 'production releases of every personal app of your account (company apps keep their organization’s freezes)';
  }
}

/**
 * The route that lifts `freeze`. One on a single app is lifted through that
 * app, whichever owner holds it; one on all apps through its owner, the
 * organization's or the account's (release_freezes_org.go:68-158).
 */
export function liftOwner(freeze: Pick<ReleaseFreeze, 'app' | 'org'>): FreezeOwner {
  if (freeze.app) return { kind: 'app', slug: freeze.app };
  if (freeze.org) return { kind: 'org', org: freeze.org };
  return { kind: 'account' };
}

/** "45 min", "2 h", "1 h 30 min", "3 d", "2 d 4 h". */
export function minutesLabel(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0 min';
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days && !minutes) return hours ? `${days} d ${hours} h` : `${days} d`;
  if (days) return `${days} d ${hours} h ${minutes} min`;
  if (hours) return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  return `${minutes} min`;
}

const DAY_NAMES: Record<Weekday, string> = {
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
};

/** "Every Fri at 16:00 for 2 d 16 h, Europe/Istanbul time". */
export function weeklyLabel(weekly: NonNullable<ReleaseFreeze['weekly']>): string {
  const days = weekly.days.map((d) => DAY_NAMES[d] ?? d).join(', ');
  return `Every ${days} at ${weekly.start} for ${minutesLabel(weekly.duration_minutes)}, ${weekly.time_zone} time`;
}

/** Whether a reason is one apid accepts (freeze.ValidateReason: trimmed, 1-200 characters). */
export function reasonProblem(reason: string): string | undefined {
  const trimmed = reason.trim();
  if (!trimmed) return 'Give a reason; it is shown to everyone the freeze stops.';
  if (trimmed.length > FREEZE_REASON_MAX) return `At most ${FREEZE_REASON_MAX} characters.`;
  return undefined;
}

/** A window's end must follow its start (default now) and be in the future (freeze.FromRequest). */
export function windowEndProblem(
  startIso: string | null,
  endIso: string | null,
  now = Date.now()
): string | undefined {
  if (!endIso) return undefined;
  const end = Date.parse(endIso);
  const from = startIso ? Date.parse(startIso) : now;
  return end <= from || end <= now
    ? 'The end must be after the start and in the future.'
    : undefined;
}

/** An IANA zone the browser knows, the way apid's time.LoadLocation does. */
export function validTimeZone(zone: string): boolean {
  if (!zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const root = ['release-freezes'] as const;
const ownerKey = (owner: FreezeOwner) =>
  owner.kind === 'app'
    ? ([...root, 'app', owner.slug] as const)
    : owner.kind === 'org'
      ? ([...root, 'org', owner.org] as const)
      : ([...root, 'account'] as const);

/** The freezes `owner` holds, or, for an app, every freeze that covers it. */
export function useReleaseFreezes(owner: FreezeOwner | null) {
  return useQuery({
    queryKey: owner ? ownerKey(owner) : [...root, 'none'],
    queryFn: async ({ signal }) => {
      if (!owner) return [];
      const read =
        owner.kind === 'app'
          ? api.GET('/v1/apps/{slug}/freezes', { params: { path: { slug: owner.slug } }, signal })
          : owner.kind === 'org'
            ? api.GET('/v1/orgs/{slug}/freezes', { params: { path: { slug: owner.org } }, signal })
            : api.GET('/v1/freezes', { signal });
      return (await unwrap(read)).freezes;
    },
    enabled: Boolean(owner),
    retry: retryPolicy,
  });
}

/** Whether a production release of the app would be refused now, and the next freeze within a week. */
export function useFreezeStatus(slug: string, enabled = true) {
  return useQuery({
    queryKey: [...root, 'status', slug],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/v1/apps/{slug}/freeze-status', { params: { path: { slug } }, signal })),
    enabled: enabled && Boolean(slug),
    retry: retryPolicy,
    // An active window ends, and a weekly one opens, on the clock.
    refetchInterval: 60_000,
  });
}

/**
 * Every freeze list and status changes together: an organization's or an
 * account's freeze covers apps whose own lists are cached separately.
 */
function useFreezeRefresh() {
  const cache = useQueryClient();
  return () => {
    void cache.invalidateQueries({ queryKey: root });
    void cache.invalidateQueries({ queryKey: keys.deployments });
  };
}

export function useCreateReleaseFreeze() {
  const refresh = useFreezeRefresh();
  return useMutation({
    retry: false,
    mutationFn: ({ owner, body }: { owner: FreezeOwner; body: CreateReleaseFreeze }) =>
      unwrap(
        owner.kind === 'app'
          ? api.POST('/v1/apps/{slug}/freezes', { params: { path: { slug: owner.slug } }, body })
          : owner.kind === 'org'
            ? api.POST('/v1/orgs/{slug}/freezes', { params: { path: { slug: owner.org } }, body })
            : api.POST('/v1/freezes', { body })
      ),
    onSettled: refresh,
  });
}

export function useLiftReleaseFreeze() {
  const refresh = useFreezeRefresh();
  return useMutation({
    retry: false,
    mutationFn: (freeze: Pick<ReleaseFreeze, 'id' | 'app' | 'org'>) => {
      const owner = liftOwner(freeze);
      return unwrap(
        owner.kind === 'app'
          ? api.DELETE('/v1/apps/{slug}/freezes/{id}', {
              params: { path: { slug: owner.slug, id: freeze.id } },
            })
          : owner.kind === 'org'
            ? api.DELETE('/v1/orgs/{slug}/freezes/{id}', {
                params: { path: { slug: owner.org, id: freeze.id } },
              })
            : api.DELETE('/v1/freezes/{id}', { params: { path: { id: freeze.id } } })
      );
    },
    onSettled: refresh,
  });
}
