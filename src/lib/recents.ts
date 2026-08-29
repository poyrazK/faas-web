import { NAV_ITEMS } from '@/components/dashboard/nav-config';

/**
 * Recently visited console pages, for the overview's Recents column.
 *
 * Client behaviour, not server data: the shell records each dashboard
 * navigation into localStorage and the overview reads the newest few back.
 * Private windows and blocked storage degrade to an empty list — the
 * column then says so instead of pretending.
 */

const KEY = 'gregale.recents';
/** Stored depth; the overview shows fewer. */
const STORE_MAX = 8;

export interface RecentVisit {
  path: string;
  at: number;
}

export function recordVisit(pathname: string): void {
  // The overview itself is where recents are read — recording it would fill
  // the list with "Overview" rows that say nothing.
  if (!pathname.startsWith('/dashboard/')) return;
  try {
    const list = readRecents().filter((r) => r.path !== pathname);
    list.unshift({ path: pathname, at: Date.now() });
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, STORE_MAX)));
  } catch {
    // Storage unavailable — recents simply stay empty.
  }
}

export function readRecents(): RecentVisit[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RecentVisit =>
        typeof r === 'object' &&
        r !== null &&
        typeof (r as RecentVisit).path === 'string' &&
        typeof (r as RecentVisit).at === 'number'
    );
  } catch {
    return [];
  }
}

/** `/dashboard/workflows/api-gateway` → section "Apps", detail "api-gateway". */
export function recentLabel(path: string): { section: string; detail?: string } {
  const segments = path
    .replace(/^\/dashboard\//, '')
    .split('/')
    .filter(Boolean);
  const base = `/dashboard/${segments[0]}`;
  const section = NAV_ITEMS.find((n) => n.to === base)?.label ?? segments[0];
  return { section, detail: segments[1] };
}
