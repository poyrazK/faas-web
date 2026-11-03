import type { LifecycleRule } from '@/lib/api/object-storage';

/**
 * One lifecycle rule as a form holds it: strings while being typed, turned
 * into the API shape only on save. The checks mirror apid's own
 * (faas pkg/api/object_lifecycle.go:156-198) so a rule it would refuse is
 * caught beside the field rather than as a 400 after the click.
 */
export interface RuleDraft {
  id: string;
  enabled: boolean;
  prefix: string;
  /** `key=value, key=value`. */
  tags: string;
  expire: 'none' | 'days' | 'date' | 'markers';
  expireDays: string;
  /** `YYYY-MM-DD`; saved as that day's UTC midnight. */
  expireDate: string;
  noncurrent: boolean;
  noncurrentDays: string;
  keepNewer: string;
  abort: boolean;
  abortDays: string;
}

export const MAX_RULES = 1000;
const MAX_TAGS = 10;
const MAX_KEEP = 100;
const INT32 = 2_147_483_647;

export function blankDraft(): RuleDraft {
  return {
    id: '',
    enabled: true,
    prefix: '',
    tags: '',
    expire: 'none',
    expireDays: '',
    expireDate: '',
    noncurrent: false,
    noncurrentDays: '',
    keepNewer: '',
    abort: false,
    abortDays: '',
  };
}

export function toDraft(rule: LifecycleRule): RuleDraft {
  const e = rule.expiration;
  const n = rule.noncurrent_version_expiration;
  return {
    id: rule.id ?? '',
    enabled: rule.status === 'Enabled',
    prefix: rule.filter?.prefix ?? '',
    tags: Object.entries(rule.filter?.tags ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(', '),
    expire: e?.days
      ? 'days'
      : e?.date
        ? 'date'
        : e?.expired_object_delete_marker
          ? 'markers'
          : 'none',
    expireDays: e?.days ? String(e.days) : '',
    expireDate: e?.date ? e.date.slice(0, 10) : '',
    noncurrent: Boolean(n),
    noncurrentDays: n ? String(n.noncurrent_days) : '',
    keepNewer: n?.newer_noncurrent_versions ? String(n.newer_noncurrent_versions) : '',
    abort: Boolean(rule.abort_incomplete_multipart_days),
    abortDays: rule.abort_incomplete_multipart_days
      ? String(rule.abort_incomplete_multipart_days)
      : '',
  };
}

function parseTags(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const part of text.split(',')) {
    const pair = part.trim();
    if (!pair) continue;
    const at = pair.indexOf('=');
    if (at <= 0) return null;
    out[pair.slice(0, at).trim()] = pair.slice(at + 1).trim();
  }
  return out;
}

const days = (text: string) => Number(text.trim());
const wholeDays = (text: string) => {
  const n = days(text);
  return Number.isInteger(n) && n >= 1 && n <= INT32;
};

export function fromDraft(draft: RuleDraft): LifecycleRule {
  const rule: LifecycleRule = { status: draft.enabled ? 'Enabled' : 'Disabled' };
  if (draft.id.trim()) rule.id = draft.id.trim();
  const tags = parseTags(draft.tags) ?? {};
  const filter: NonNullable<LifecycleRule['filter']> = {};
  if (draft.prefix) filter.prefix = draft.prefix;
  if (Object.keys(tags).length) filter.tags = tags;
  if (Object.keys(filter).length) rule.filter = filter;
  if (draft.expire === 'days') rule.expiration = { days: days(draft.expireDays) };
  if (draft.expire === 'date') rule.expiration = { date: `${draft.expireDate}T00:00:00Z` };
  if (draft.expire === 'markers') rule.expiration = { expired_object_delete_marker: true };
  if (draft.noncurrent)
    rule.noncurrent_version_expiration = {
      noncurrent_days: days(draft.noncurrentDays),
      ...(draft.keepNewer.trim() ? { newer_noncurrent_versions: days(draft.keepNewer) } : {}),
    };
  if (draft.abort) rule.abort_incomplete_multipart_days = days(draft.abortDays);
  return rule;
}

/** One list of problems per draft, in the order given; empty lists mean it can be saved. */
export function draftProblems(drafts: RuleDraft[]): string[][] {
  const ids = drafts.map((d) => d.id.trim()).filter(Boolean);
  const repeated = new Set(ids.filter((id, i) => ids.indexOf(id) !== i));
  return drafts.map((d) => {
    const out: string[] = [];
    const tags = parseTags(d.tags);
    if (d.expire === 'none' && !d.noncurrent && !d.abort)
      out.push('Choose at least one thing for this rule to do.');
    if (
      (d.expire === 'days' && !wholeDays(d.expireDays)) ||
      (d.noncurrent && !wholeDays(d.noncurrentDays)) ||
      (d.abort && !wholeDays(d.abortDays))
    )
      out.push('Days must be a whole number of at least 1.');
    if (d.expire === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(d.expireDate))
      out.push('Pick the date to delete objects on.');
    if (d.noncurrent && d.keepNewer.trim()) {
      const keep = days(d.keepNewer);
      if (!Number.isInteger(keep) || keep < 1 || keep > MAX_KEEP)
        out.push(`Keep between 1 and ${MAX_KEEP} newer versions.`);
    }
    if (tags === null) out.push('Write tags as key=value, separated by commas.');
    else if (Object.keys(tags).length > MAX_TAGS) out.push(`Filter on at most ${MAX_TAGS} tags.`);
    if (tags && Object.keys(tags).length && (d.abort || d.expire === 'markers'))
      out.push('A tag filter cannot be combined with aborting uploads or clearing delete markers.');
    if (new TextEncoder().encode(d.prefix).length > 1024)
      out.push('A prefix can be at most 1024 bytes.');
    if (d.id.trim().length > 255) out.push('A rule ID can be at most 255 characters.');
    if (repeated.has(d.id.trim())) out.push('Rule IDs must be unique.');
    return out;
  });
}

/** True when saving would let apid delete data on its own: confirm before that. */
export function deletesData(drafts: RuleDraft[]): boolean {
  return drafts.some(
    (d) => d.enabled && (d.expire === 'days' || d.expire === 'date' || d.noncurrent)
  );
}

/** What a lifecycle rule does, as the sentences a person would say. */
export function ruleSentences(rule: LifecycleRule): string[] {
  const scope = [
    rule.filter?.prefix ? `under ${rule.filter.prefix}` : '',
    ...Object.entries(rule.filter?.tags ?? {}).map(([k, v]) => `tagged ${k}=${v}`),
  ]
    .filter(Boolean)
    .join(' ');
  const objects = scope ? `objects ${scope}` : 'objects';
  const out: string[] = [];
  if (rule.expiration?.days)
    out.push(`Delete ${objects} ${rule.expiration.days} days after they are written`);
  // apid stores the date as a UTC midnight; read it in UTC so it is the same day everywhere.
  if (rule.expiration?.date)
    out.push(
      `Delete ${objects} on ${new Date(rule.expiration.date).toLocaleDateString(undefined, { timeZone: 'UTC' })}`
    );
  if (rule.expiration?.expired_object_delete_marker)
    out.push('Clear delete markers left with no versions behind them');
  if (rule.noncurrent_version_expiration?.noncurrent_days) {
    const keep = rule.noncurrent_version_expiration.newer_noncurrent_versions;
    out.push(
      `Delete old versions of ${objects} ${rule.noncurrent_version_expiration.noncurrent_days} days after they are replaced${keep ? `, keeping the newest ${keep}` : ''}`
    );
  }
  if (rule.abort_incomplete_multipart_days)
    out.push(
      `Abort unfinished multipart uploads after ${rule.abort_incomplete_multipart_days} days`
    );
  return rule.status === 'Disabled' ? out.map((s) => `${s} (paused)`) : out;
}
