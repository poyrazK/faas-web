import { LOG_LEVELS, type LogLevelFilter } from '@/lib/api/logs';
import { resourceId } from '@/lib/resource-id';

export interface LogsSearch {
  app?: string;
  level?: LogLevelFilter;
  q?: string;
  mode?: 'archive';
  instance?: string;
  date?: string;
}
export interface LogFilters {
  level: LogLevelFilter | '';
  grep: string;
  mode: 'live' | 'archive';
  instance: string;
  date: string;
}
export const isoDay = (offsetDays = 0) =>
  new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10);

export function validLogDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateLogsSearch(raw: Record<string, unknown>): LogsSearch {
  return {
    // Preserve unknown app names so the page can report unavailable access,
    // rather than silently fall back to another app's investigation.
    ...(typeof raw.app === 'string' && raw.app.trim() ? { app: raw.app.trim() } : {}),
    ...(LOG_LEVELS.includes(raw.level as LogLevelFilter)
      ? { level: raw.level as LogLevelFilter }
      : {}),
    ...(typeof raw.q === 'string' && raw.q && raw.q.length <= 2048 ? { q: raw.q } : {}),
    ...(raw.mode === 'archive' ? { mode: 'archive' as const } : {}),
    ...(resourceId(raw.instance) ? { instance: resourceId(raw.instance) } : {}),
    ...(validLogDate(raw.date) ? { date: raw.date } : {}),
  };
}
export function logFilters(search: LogsSearch): LogFilters {
  return {
    level: search.level ?? '',
    grep: search.q ?? '',
    mode: search.mode ?? 'live',
    instance: search.instance ?? '',
    date: search.date ?? isoDay(1),
  };
}
export function logsSearch(filters: LogFilters, app?: string): LogsSearch {
  return validateLogsSearch({
    app,
    level: filters.level,
    q: filters.grep,
    ...(filters.mode === 'archive'
      ? { mode: 'archive', instance: filters.instance, date: filters.date }
      : {}),
  });
}

/** Explicit undefined fields clear old filters while preserving other tab context. */
export function logsSearchPatch(search: LogsSearch) {
  return {
    level: search.level,
    q: search.q,
    mode: search.mode,
    instance: search.instance,
    date: search.date,
  };
}
