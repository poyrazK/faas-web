import type { ComponentType, ReactNode } from 'react';
import { ApiError } from '@/lib/api/errors';

/**
 * Pieces the Postgres panels share: the error explanations, the status tag,
 * and the units the API reports in (compute-unit seconds, bytes).
 */

export const TONE = {
  good: 'var(--status-good)',
  warning: 'var(--status-warning)',
  critical: 'var(--status-critical)',
  muted: 'var(--chart-muted)',
} as const;
export type Tone = keyof typeof TONE;

/** Colour, icon and words together: a state never rests on hue alone. */
export function StatusTag({
  tone,
  icon: Icon,
  children,
}: {
  tone: Tone;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  children: ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{
        color: TONE[tone],
        borderColor: `color-mix(in oklab, ${TONE[tone]} 35%, transparent)`,
      }}
    >
      <Icon aria-hidden className="h-3 w-3 shrink-0" />
      {children}
    </span>
  );
}

/** Compute-unit seconds as compute-unit hours, the unit the plans are sold in. */
export function cuHours(seconds: number): string {
  const hours = seconds / 3600;
  const value = hours >= 100 ? Math.round(hours) : Math.round(hours * 10) / 10;
  return `${value.toLocaleString('en-US')} CU-h`;
}

/** Plan storage is sold in GiB (docs/postgres.md § Plans). */
export function gib(bytes: number): string {
  const value = Math.round((bytes / 1024 ** 3) * 10) / 10;
  return `${value.toLocaleString('en-US')} GiB`;
}

/** Transfer, in decimal units as a network meter reads. */
export function transfer(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} kB`;
  return `${bytes} B`;
}

export function explainPostgres(err: unknown): {
  kind: 'info' | 'error';
  title: string;
  description?: string;
  error?: unknown;
} {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'managed_postgres_not_in_plan':
        return { kind: 'info', title: 'Not on your plan', error: err };
      case 'managed_postgres_quota_exceeded':
        return { kind: 'info', title: 'Database limit reached', error: err };
      case 'managed_postgres_unsupported':
        return {
          kind: 'error',
          title: 'Not supported',
          error: err,
        };
      case 'managed_postgres_conflict':
        return {
          kind: 'error',
          title: 'That name or binding is taken',
          error: err,
        };
      case 'managed_postgres_invalid':
        return { kind: 'error', title: 'The request was rejected', error: err };
      case 'managed_postgres_unavailable':
      case 'managed_postgres_usage_stale':
        return {
          kind: 'info',
          title: 'The database provider is unavailable',
          description: 'Nothing was changed. This is upstream of Gregale; try again shortly.',
        };
      case 'managed_postgres_provisioning_not_enabled':
      case 'managed_postgres_new_databases_paused':
        return { kind: 'info', title: 'New database work is paused', error: err };
      case 'managed_postgres_not_found':
        return { kind: 'info', title: 'Already gone', description: 'It was removed elsewhere.' };
      case 'org_role_forbidden':
        return {
          kind: 'info',
          title: 'Your role cannot do that',
          description: "An organization's owners and admins manage its databases.",
          error: err,
        };
    }
  }
  return { kind: 'error', title: 'Could not complete that', error: err };
}
