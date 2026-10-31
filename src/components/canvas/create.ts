import { ApiError } from '@/lib/api/errors';
import { isCronSchedule } from '@/lib/cron-schedule';
import type { ConnectSide } from './nodes';

export type CreateKind = 'domain' | 'cron' | 'bucket';

/** Ports are directional: left adds traffic into an app, right adds what it talks to. */
export const CREATE_OPTIONS: Record<
  ConnectSide,
  { kind: CreateKind; label: string; hint: string; key: string }[]
> = {
  in: [
    { kind: 'domain', label: 'Domain', hint: 'Route a hostname to this app', key: 'd' },
    { kind: 'cron', label: 'Cron', hint: 'Call it on a schedule', key: 'c' },
  ],
  out: [{ kind: 'bucket', label: 'Bucket', hint: 'Store objects for this app', key: 'b' }],
};

/** Shape only. The server is the authority on what it will accept. */
export function validateHostname(v: string): string | undefined {
  const host = v.trim();
  if (!host) return 'Enter a hostname.';
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host))
    return 'Use a bare hostname like api.example.com, with no scheme or path.';
}

export function validateBucketName(v: string): string | undefined {
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(v))
    return 'Start with a lowercase letter; then lowercase letters, digits and dashes (max 63).';
}

export function validateCron({
  schedule,
  path,
}: {
  schedule: string;
  path: string;
}): string | undefined {
  if (!isCronSchedule(schedule))
    return 'A schedule has five fields: minute hour day month weekday.';
  if (path && !path.startsWith('/')) return 'The path must start with /.';
}

const KNOWN: Record<string, string> = {
  invalid_domain: 'That hostname is not valid.',
  domain_exists: 'That hostname is already connected to an app.',
  invalid_schedule: 'A schedule has five fields: minute hour day month weekday.',
  cron_invalid: 'The schedule was rejected. Check each field.',
  object_storage_invalid: 'Bucket names are lowercase letters, digits and dashes.',
  object_storage_conflict:
    'A bucket with that name already exists, or the app is at its bucket limit.',
  object_storage_unavailable: 'Object storage is not enabled for this account.',
  app_not_found: 'That app no longer exists.',
};

/** Branch on the code; the server's own prose for anything unknown. */
export function createErrorMessage(e: unknown): string {
  if (e instanceof ApiError) return KNOWN[e.code] ?? e.message;
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Try again.';
}
