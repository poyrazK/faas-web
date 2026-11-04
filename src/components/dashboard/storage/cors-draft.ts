import type { CorsRule } from '@/lib/api/object-storage';

export const CORS_METHODS = ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'] as const;
export type CorsMethod = (typeof CORS_METHODS)[number];
export const MAX_CORS_RULES = 100;
const MAX_VALUES = 100;
const MAX_AGE = 86_400;

/**
 * One CORS rule as the form holds it. The checks mirror apid's
 * (faas pkg/api/object_bucket_cors.go:38-95): origins are `*` or an http(s)
 * origin with at most one `*` and no path, header patterns allow one `*`.
 */
export interface CorsDraft {
  id: string;
  /** One per line or comma separated. */
  origins: string;
  methods: CorsMethod[];
  headers: string;
  expose: string;
  maxAge: string;
}

export function blankCorsDraft(): CorsDraft {
  return { id: '', origins: '', methods: ['GET', 'PUT'], headers: '', expose: '', maxAge: '' };
}

export function corsToDraft(rule: CorsRule): CorsDraft {
  return {
    id: rule.id ?? '',
    origins: rule.allowed_origins.join('\n'),
    methods: CORS_METHODS.filter((m) => rule.allowed_methods.includes(m)),
    headers: (rule.allowed_headers ?? []).join(', '),
    expose: (rule.expose_headers ?? []).join(', '),
    maxAge: rule.max_age_seconds === undefined ? '' : String(rule.max_age_seconds),
  };
}

const list = (text: string) =>
  text
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

export function corsFromDraft(draft: CorsDraft): CorsRule {
  const rule: CorsRule = {
    allowed_origins: list(draft.origins),
    allowed_methods: [...draft.methods],
  };
  if (draft.id.trim()) rule.id = draft.id.trim();
  const headers = list(draft.headers);
  const expose = list(draft.expose);
  if (headers.length) rule.allowed_headers = headers;
  if (expose.length) rule.expose_headers = expose;
  if (draft.maxAge.trim()) rule.max_age_seconds = Number(draft.maxAge.trim());
  return rule;
}

export function validOrigin(origin: string): boolean {
  if (origin === '*') return true;
  if ((origin.match(/\*/g) ?? []).length > 1 || /\s/.test(origin)) return false;
  try {
    const url = new URL(origin.replace('*', 'wildcard'));
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      Boolean(url.host) &&
      !url.username &&
      !url.password &&
      url.search === '' &&
      url.hash === '' &&
      // `new URL` adds "/" to a bare origin; anything longer is a path.
      url.pathname === '/' &&
      !origin.replace(/^https?:\/\//, '').includes('/')
    );
  } catch {
    return false;
  }
}

/** An HTTP header token, optionally with one `*` in a pattern. */
const headerName = (name: string) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name);
const headerPattern = (name: string) =>
  (name.match(/\*/g) ?? []).length <= 1 && headerName(name.replace('*', 'x'));

export function corsProblems(drafts: CorsDraft[]): string[][] {
  const ids = drafts.map((d) => d.id.trim()).filter(Boolean);
  const repeated = new Set(ids.filter((id, i) => ids.indexOf(id) !== i));
  return drafts.map((d) => {
    const out: string[] = [];
    const origins = list(d.origins);
    const bad = origins.filter((o) => !validOrigin(o));
    if (origins.length === 0) out.push('Add at least one origin.');
    if (bad.length)
      out.push(
        `Not an origin: ${bad.join(', ')}. Use * or https://host, with at most one * and no path.`
      );
    if (d.methods.length === 0) out.push('Allow at least one method.');
    if (!list(d.headers).every(headerPattern))
      out.push('Allowed headers are header names, each with at most one *.');
    if (!list(d.expose).every(headerName)) out.push('Exposed headers are plain header names.');
    if ([origins, list(d.headers), list(d.expose)].some((l) => l.length > MAX_VALUES))
      out.push(`Each list holds at most ${MAX_VALUES} entries.`);
    if (d.maxAge.trim()) {
      const age = Number(d.maxAge.trim());
      if (!Number.isInteger(age) || age < 0 || age > MAX_AGE)
        out.push(`Cache time is 0 to ${MAX_AGE} seconds.`);
    }
    if (d.id.trim().length > 255) out.push('A rule ID can be at most 255 characters.');
    if (repeated.has(d.id.trim())) out.push('Rule IDs must be unique.');
    return out;
  });
}

/** A rule as one sentence: what it lets which pages do. */
export function corsSentence(rule: CorsRule): string {
  const origins = rule.allowed_origins.includes('*') ? 'any site' : rule.allowed_origins.join(', ');
  const parts = [`${rule.allowed_methods.join(', ')} from ${origins}`];
  if (rule.allowed_headers?.length) parts.push(`sending ${rule.allowed_headers.join(', ')}`);
  if (rule.expose_headers?.length) parts.push(`reading ${rule.expose_headers.join(', ')}`);
  if (rule.max_age_seconds !== undefined) parts.push(`cached ${rule.max_age_seconds} s`);
  return parts.join(' · ');
}
