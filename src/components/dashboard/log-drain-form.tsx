import { useId } from 'react';
import { FIELD, FieldError, Select } from '@/components/ui/field';
import { ApiError, errorMessage } from '@/lib/api/errors';
import type { CreateLogDrain, LogDrain, LogDrainKind, UpdateLogDrain } from '@/lib/api/log-drains';
import {
  DATADOG_SITES,
  datadogAuthHeader,
  datadogIntakeUrl,
  datadogSiteOf,
  type DatadogSite,
} from '@/lib/log-drain-datadog';
import { cn } from '@/lib/utils';

export const KIND_LABELS: Record<LogDrainKind, string> = {
  http_json: 'HTTP (JSON lines)',
  otlp: 'OpenTelemetry (OTLP)',
  datadog: 'Datadog',
};

/** A drain's kind as a person reads it; a Datadog drain names its site. */
export function kindLabel(drain: Pick<LogDrain, 'kind' | 'target_url'>): string {
  const label = KIND_LABELS[drain.kind] ?? drain.kind;
  const site = drain.kind === 'datadog' ? datadogSiteOf(drain.target_url) : undefined;
  return site ? `${label} · ${site}` : label;
}

/**
 * The form's state. Secrets (the auth header, the Datadog API key) are
 * write-only: apid seals them and returns only `auth_header_masked`, so an
 * edit starts with them empty, and empty means "keep what is stored".
 */
export interface LogDrainDraft {
  kind: LogDrainKind;
  url: string;
  site: DatadogSite;
  apiKey: string;
  auth: string;
  /** Edit only: send an empty header, which clears the stored one. */
  clearAuth: boolean;
}

export function emptyDraft(): LogDrainDraft {
  return { kind: 'http_json', url: '', site: 'us1', apiKey: '', auth: '', clearAuth: false };
}

export function draftFrom(drain: LogDrain): LogDrainDraft {
  const kind = drain.kind;
  return {
    ...emptyDraft(),
    kind,
    url: kind === 'datadog' ? '' : drain.target_url,
    site: datadogSiteOf(drain.target_url) ?? 'us1',
  };
}

function validUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** apid takes exactly one "Name: value" pair (handlers_log_drains.go:92). */
function validHeader(value: string) {
  const parts = value.split(':');
  return parts.length === 2 && /^[^\s]+$/.test(parts[0].trim()) && parts[1].trim() !== '';
}

const targetOf = (draft: LogDrainDraft) =>
  draft.kind === 'datadog' ? datadogIntakeUrl(draft.site) : draft.url.trim();

export function draftErrors(
  draft: LogDrainDraft,
  existing?: LogDrain
): { url?: string; auth?: string; apiKey?: string } {
  if (draft.kind === 'datadog') {
    // A key is required unless the drain already authenticates to Datadog.
    const keyRequired = existing?.kind !== 'datadog';
    if (!draft.apiKey.trim()) return keyRequired ? { apiKey: 'Enter your Datadog API key.' } : {};
    return /[\s:]/.test(draft.apiKey.trim())
      ? { apiKey: 'A Datadog API key has no spaces or colons.' }
      : {};
  }
  const errors: { url?: string; auth?: string } = {};
  if (!validUrl(draft.url)) errors.url = 'Enter an http(s) URL.';
  if (draft.auth && !validHeader(draft.auth))
    errors.auth = 'Use one "Name: value" pair, for example "Authorization: Bearer …".';
  return errors;
}

export function createBody(draft: LogDrainDraft): CreateLogDrain {
  const auth = draft.kind === 'datadog' ? datadogAuthHeader(draft.apiKey) : draft.auth.trim();
  return {
    kind: draft.kind,
    target_url: targetOf(draft),
    ...(auth ? { auth_header: auth } : {}),
    enabled: true,
  };
}

/** The PATCH body: only the fields that changed (omitted ones stay as they are). */
export function updateBody(draft: LogDrainDraft, drain: LogDrain): UpdateLogDrain {
  const body: UpdateLogDrain = {};
  if (draft.kind !== drain.kind) body.kind = draft.kind;
  const target = targetOf(draft);
  if (target !== drain.target_url) body.target_url = target;
  if (draft.kind === 'datadog') {
    if (draft.apiKey.trim()) body.auth_header = datadogAuthHeader(draft.apiKey);
  } else if (draft.auth.trim()) {
    body.auth_header = draft.auth.trim();
  } else if (draft.clearAuth || (drain.kind === 'datadog' && drain.auth_header_masked)) {
    // Leaving Datadog drops its API key; apid would otherwise keep sending it
    // as a header to the new destination.
    body.auth_header = '';
  }
  return body;
}

/**
 * Why apid refused a save, shown in the dialog so the fields stay to fix.
 * Datadog's two refusals get their own words: the API's prose names the
 * deployment flag, not what the customer can do instead.
 */
export function LogDrainProblem({ error }: { error: unknown }) {
  if (!error) return null;
  const code = error instanceof ApiError ? error.code : '';
  const message =
    code === 'datadog_integration_unavailable'
      ? 'Datadog destinations are not available on this installation. An OpenTelemetry (OTLP) destination pointed at a Datadog Agent or collector works instead.'
      : code === 'capability_not_released'
        ? 'Datadog destinations are not enabled for this account yet.'
        : errorMessage(error);
  return (
    <p role="alert" className="text-xs" style={{ color: 'var(--status-critical)' }}>
      {message}
      {code === 'plan_log_drain_quota' && (
        <>
          {' '}
          <a className="text-brand underline" href="/dashboard/plans">
            View plans
          </a>
        </>
      )}
    </p>
  );
}

/**
 * The fields shared by adding and editing a destination. Datadog swaps the URL
 * and header for a site and an API key, because apid accepts only a Datadog
 * intake and a `DD-API-KEY` header for that kind.
 */
export function LogDrainFields({
  draft,
  onChange,
  kinds,
  existing,
  attempted,
}: {
  draft: LogDrainDraft;
  onChange: (draft: LogDrainDraft) => void;
  kinds: LogDrainKind[];
  /** The stored drain, when editing. */
  existing?: LogDrain;
  attempted: boolean;
}) {
  const id = useId();
  const errors = attempted ? draftErrors(draft, existing) : {};
  const set = (patch: Partial<LogDrainDraft>) => onChange({ ...draft, ...patch });
  // A Datadog drain stays editable even when new Datadog drains are not offered.
  const options = existing && !kinds.includes(existing.kind) ? [...kinds, existing.kind] : kinds;
  const storedAuth = Boolean(existing?.auth_header_masked);
  const leavingDatadog = existing?.kind === 'datadog' && draft.kind !== 'datadog';
  const authHint = leavingDatadog
    ? 'The Datadog API key is removed unless you enter a header.'
    : storedAuth
      ? 'A header is set. Leave empty to keep the current header; it is never shown.'
      : 'Sealed when saved and never shown again.';
  return (
    <div className="grid gap-4">
      <label className="flex flex-col gap-1.5 text-xs font-medium">
        Format
        <Select
          value={draft.kind}
          onChange={(event) => set({ kind: event.target.value as LogDrainKind })}
        >
          {options.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABELS[kind]}
            </option>
          ))}
        </Select>
      </label>
      {draft.kind === 'datadog' ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-site`} className="text-xs font-medium">
              Datadog site
            </label>
            <Select
              id={`${id}-site`}
              value={draft.site}
              onChange={(event) => set({ site: event.target.value as DatadogSite })}
              aria-describedby={`${id}-site-hint`}
            >
              {DATADOG_SITES.map((s) => (
                <option key={s.site} value={s.site}>
                  {s.site.toUpperCase()} · {s.domain}
                </option>
              ))}
            </Select>
            <span id={`${id}-site-hint`} className="text-xs text-muted-foreground">
              Logs go to <span className="font-mono break-all">{datadogIntakeUrl(draft.site)}</span>
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-key`} className="text-xs font-medium">
              Datadog API key
            </label>
            <input
              id={`${id}-key`}
              type="password"
              value={draft.apiKey}
              onChange={(event) => set({ apiKey: event.target.value })}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={errors.apiKey ? true : undefined}
              aria-describedby={`${id}-key-hint${errors.apiKey ? ` ${id}-key-error` : ''}`}
              className={cn(FIELD, 'font-mono')}
            />
            <span id={`${id}-key-hint`} className="text-xs text-muted-foreground">
              {existing?.kind === 'datadog'
                ? 'Leave empty to keep the current key; it is never shown.'
                : 'Sent as DD-API-KEY. Sealed when saved and never shown again.'}
            </span>
            {errors.apiKey && <FieldError id={`${id}-key-error`}>{errors.apiKey}</FieldError>}
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-url`} className="text-xs font-medium">
              Endpoint URL
            </label>
            <input
              id={`${id}-url`}
              value={draft.url}
              onChange={(event) => set({ url: event.target.value })}
              placeholder="https://logs.example.com/ingest"
              spellCheck={false}
              aria-invalid={errors.url ? true : undefined}
              aria-describedby={errors.url ? `${id}-url-error` : undefined}
              className={cn(FIELD, 'font-mono')}
            />
            {errors.url && <FieldError id={`${id}-url-error`}>{errors.url}</FieldError>}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-auth`} className="text-xs font-medium">
              Auth header (optional)
            </label>
            <input
              id={`${id}-auth`}
              value={draft.auth}
              onChange={(event) => set({ auth: event.target.value })}
              placeholder="Authorization: Bearer …"
              autoComplete="off"
              spellCheck={false}
              disabled={draft.clearAuth}
              aria-invalid={errors.auth ? true : undefined}
              aria-describedby={`${id}-auth-hint${errors.auth ? ` ${id}-auth-error` : ''}`}
              className={cn(FIELD, 'font-mono')}
            />
            <span id={`${id}-auth-hint`} className="text-xs text-muted-foreground">
              {authHint}
            </span>
            {errors.auth && <FieldError id={`${id}-auth-error`}>{errors.auth}</FieldError>}
            {storedAuth && !leavingDatadog && (
              <label className="flex items-center gap-2 self-start text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={draft.clearAuth}
                  onChange={(event) => set({ clearAuth: event.target.checked, auth: '' })}
                  className="h-3.5 w-3.5 accent-[color:var(--brand)]"
                />
                Remove the auth header
              </label>
            )}
          </div>
        </>
      )}
    </div>
  );
}
