import type { paths } from '@/lib/api/schema';

export type AuditQuery = NonNullable<paths['/v1/audit-events']['get']['parameters']['query']>;

export interface AuditFilters {
  /** A `datetime-local` input value; converted to RFC 3339 UTC on the wire. */
  since: string;
  kind_prefix: string;
  limit: number;
  include_anonymous: boolean;
  /** App id (uuid), not slug — the API filters `data.app_id`. */
  app_id: string;
}

export const DEFAULT_AUDIT_FILTERS: AuditFilters = {
  since: '',
  kind_prefix: '',
  limit: 100,
  include_anonymous: false,
  app_id: '',
};

/** Blank filters stay off the wire; the server's defaults are the CLI's defaults. */
export function auditQuery(f: AuditFilters): AuditQuery {
  const q: AuditQuery = { limit: f.limit };
  if (f.since) q.since = new Date(f.since).toISOString();
  if (f.kind_prefix.trim()) q.kind_prefix = f.kind_prefix.trim();
  if (f.include_anonymous) q.include_anonymous = true;
  if (f.app_id) q.app_id = f.app_id;
  return q;
}
