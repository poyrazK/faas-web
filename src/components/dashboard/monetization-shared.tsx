import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useApps } from '@/lib/api/queries';
import { ApiError } from '@/lib/api/errors';
import type { UsageWindow } from '@/lib/api/monetization';
import { CapabilityGate } from './capability-gate';

/**
 * Shared pieces of the monetization area: the capability gate, the error
 * vocabulary, and the UTC time and money formatting every page repeats.
 *
 * Everything here is in UTC on purpose. Usage is metered per UTC minute,
 * statements cover UTC periods and plan assignments start at a UTC minute, so
 * rendering any of it in local time would show a boundary the API never drew.
 */

export const MONETIZATION_CAPABILITY = 'api-monetization';

/**
 * Renders `children` only when the account has the capability. Children mount,
 * and their queries run, only past the gate. API monetization and platform
 * tenants are internal capabilities, released per account: the registry never
 * lists them, so access comes from `hidden_capabilities` (`capabilityAccess`).
 */
export function MonetizationGate({
  title,
  capability = MONETIZATION_CAPABILITY,
  children,
}: {
  title: string;
  capability?: string;
  children: ReactNode;
}) {
  return (
    <CapabilityGate capability={capability} title={title}>
      {children}
    </CapabilityGate>
  );
}

export type ToastSpec = {
  kind: 'info' | 'error';
  title: string;
  description?: string;
  error?: unknown;
};

/**
 * A failed write, in the API's own terms. Codes are the stable part of the
 * problem; the prose is shown as the description and may change.
 */
export function explainWrite(err: unknown, action: string, conflict?: string): ToastSpec {
  if (err instanceof ApiError) {
    if (err.code === 'conflict')
      return {
        kind: 'error',
        title: conflict ?? `Could not ${action}: it conflicts with the current state`,
        error: err,
      };
    if (err.code === 'validation_failed')
      return {
        kind: 'error',
        title: `Could not ${action}: check the values`,
        error: err,
      };
    if (err.code.startsWith('plan_limit') || err.status === 402)
      return { kind: 'info', title: 'Plan limit reached', error: err };
    if (err.code === 'not_found')
      return {
        kind: 'info',
        title: 'No longer there',
        description: 'It was changed or removed elsewhere.',
      };
  }
  return { kind: 'error', title: `Could not ${action}`, error: err };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-10-16 14:05 UTC`. Returns '—' for an absent or unparsable value. */
export function formatUtc(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** `2026-10-16`, the UTC calendar date. */
export function formatUtcDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** A period as the API drew it: start inclusive, end exclusive. */
export function formatPeriod(start: string, end: string): string {
  return `${formatUtc(start)} → ${formatUtc(end)}`;
}

/** 1 currency unit = 100 cents = 100,000 millicents. */
export const MILLICENTS_PER_UNIT = 100_000;

export function formatMillicents(amount: number, currency: string | undefined): string {
  const value = amount / MILLICENTS_PER_UNIT;
  if (!currency) return value.toLocaleString('en', { maximumFractionDigits: 5 });
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 5,
    }).format(value);
  } catch {
    return `${value.toLocaleString('en', { maximumFractionDigits: 5 })} ${currency}`;
  }
}

/**
 * A decimal price per unit ("0.015") as integer millicents, or undefined when
 * it is not a non-negative number with at most five decimals — the finest
 * step the API can store.
 */
export function parsePriceToMillicents(value: string): number | undefined {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,5})?$/.test(trimmed)) return undefined;
  const [whole, fraction = ''] = trimmed.split('.');
  return Number(whole) * MILLICENTS_PER_UNIT + Number(fraction.padEnd(5, '0'));
}

export const formatCount = (n: number) => n.toLocaleString('en');

/** `YYYY-MM` for the UTC month containing `date`. */
export function monthValue(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

/** The UTC month before the one containing `now` — the usual statement period. */
export function previousMonthValue(now = new Date()): string {
  return monthValue(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
}

/** `YYYY-MM` → the half-open UTC window covering that calendar month. */
export function monthWindow(month: string): UsageWindow | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return undefined;
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) return undefined;
  return {
    since: new Date(Date.UTC(year, index, 1)).toISOString(),
    until: new Date(Date.UTC(year, index + 1, 1)).toISOString(),
  };
}

/**
 * The trailing `days` whole UTC days ending at today's UTC midnight — the
 * same shape the usage endpoints default to, made explicit so the period on
 * screen is the one requested.
 */
export function trailingDays(days: number, now = new Date()): UsageWindow {
  const until = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    since: new Date(until - days * 86_400_000).toISOString(),
    until: new Date(until).toISOString(),
  };
}

/**
 * A `datetime-local` value read as a UTC minute (`2026-10-16T14:05` →
 * `2026-10-16T14:05:00Z`), or undefined when blank or malformed.
 */
export function utcMinuteFromInput(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const iso = `${value}:00Z`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

/** Parses "50, 80, 100" into ascending unique percentages, or an error message. */
export function parseThresholds(value: string): { values: number[] } | { error: string } {
  const parts = value
    .split(/[\s,]+/)
    .map((p) => p.trim().replace(/%$/, ''))
    .filter(Boolean);
  const values: number[] = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 1 || n > 100)
      return { error: 'Use whole percentages from 1 to 100.' };
    if (!values.includes(n)) values.push(n);
  }
  if (values.length > 5) return { error: 'At most five thresholds.' };
  return { values: values.sort((a, b) => a - b) };
}

/** Status colours, by the API's own status words. */
export const STATUS_COLOR: Record<string, string> = {
  active: 'var(--status-good)',
  revoked: 'var(--status-idle)',
  suspended: 'var(--status-serious)',
  draft: 'var(--status-warning)',
  finalized: 'var(--status-good)',
  superseded: 'var(--status-idle)',
};

/** A label/value list for detail panes. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="label-mono text-muted-foreground">{label}</dt>
          <dd className="break-words text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** App id → slug, from the account's app list; consumers and surfaces carry only the id. */
export function useAppNames() {
  const apps = useApps();
  return useMemo(() => new Map((apps.data ?? []).map((a) => [a.id, a.slug] as const)), [apps.data]);
}

/**
 * A detail pane opened from a row below a long list: bring it into view and
 * move focus to it once, on mount, so keyboard and screen-reader users land
 * on what they opened. Callers key the pane by the selected id.
 */
export function DetailRegion({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: 'nearest' });
  }, []);
  return (
    <div ref={ref} tabIndex={-1} role="region" aria-label={label} className="outline-none">
      {children}
    </div>
  );
}
