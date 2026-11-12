import type { ReactNode } from 'react';
import type { components } from '@/lib/api/schema';
import { useWebhooks } from '@/lib/api/queries';
import { validateCacheAction } from '@/lib/cache-policy';
import { CorsPresetPicker } from '../cors-presets';
import { SegmentedControl } from '../tabs';
import {
  ChipSet,
  HeaderOpsField,
  JsonField,
  JsonValueField,
  KeyValueField,
  LinesField,
  NumberField,
  SelectField,
  StringListField,
  TextField,
  ToggleRow,
  type HeaderOp,
} from './fields';

/**
 * One entry per edge-rule kind: what it is called, how to summarise it in a
 * table row, what an empty one looks like, what makes it invalid, and the
 * fields that edit it.
 *
 * The dialog never switches on kind — it looks the kind up here. Adding the
 * fourteenth kind is adding a row to this object, which is the whole reason
 * the shape exists.
 */

type S = components['schemas'];

/**
 * The action union is not discriminated — no `kind` field inside the action —
 * so the mapping from kind to action shape lives here, and everything else
 * derives from it.
 */
export interface ActionMap {
  route: S['EdgeRuleRouteAction'];
  rewrite: S['EdgeRuleRewriteAction'];
  redirect: S['EdgeRuleRedirectAction'];
  headers: S['EdgeRuleHeadersAction'];
  cors: S['EdgeRuleCORSAction'];
  jwt: S['EdgeRuleJWTAction'];
  ip: S['EdgeRuleIPAction'];
  validate: S['EdgeRuleValidateAction'];
  limit: S['EdgeRuleLimitAction'];
  maintenance: S['EdgeRuleMaintenanceAction'];
  geo: S['EdgeRuleGeoAction'];
  throttle: S['EdgeRuleThrottleAction'];
  budget: S['EdgeRuleBudgetAction'];
  cache: S['EdgeRuleCacheAction'];
  challenge: S['EdgeRuleChallengeAction'];
  waf: S['EdgeRuleWAFAction'];
  retry: S['EdgeRuleRetryAction'];
  circuit_breaker: S['EdgeRuleCircuitBreakerAction'];
  async: S['EdgeRuleAsyncAction'];
  respond: S['EdgeRuleRespondAction'];
}

export type Kind = keyof ActionMap;

export interface ActionFormProps<A> {
  value: A;
  onChange: (next: A) => void;
  /** Server field errors, keyed by the path the API named. */
  errors: Record<string, string>;
  apps: { slug: string }[];
  /** The app the rule belongs to — the throttle form asks it for advice. */
  slug: string;
  /** Rendered by the throttle form; supplied by the dialog. */
  suggest?: ReactNode;
  /**
   * Whether WAF warn and block are released to the account (the
   * edge-waf-blocking flag). Unreleased, a warn or block rule only observes
   * (faas edgerules/release.go:66), so the WAF form offers observe alone.
   */
  wafBlocking?: boolean;
}

export interface KindDef<K extends Kind> {
  label: string;
  desc: string;
  /** Free plans get 402 for these; the picker says so before the server does. */
  paid?: boolean;
  /** The plans whose quota for the kind is above zero, when narrower than every paid plan. */
  plans?: readonly string[];
  /**
   * The catalog capability that owns `edge_rule.<kind>` (faas
   * productcap/catalog.json), when it is released per account: apid refuses
   * the kind with 403 capability_not_released until it is.
   */
  capability?: string;
  /** A stage worth saying on the picker: preview, or released on request. */
  stage?: string;
  empty: () => ActionMap[K];
  summary: (action: ActionMap[K]) => string;
  validate: (action: ActionMap[K]) => Record<string, string>;
  Form: (props: ActionFormProps<ActionMap[K]>) => ReactNode;
}

function def<K extends Kind>(d: KindDef<K>): KindDef<K> {
  return d;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const CACHE_METHODS = ['GET', 'HEAD'] as const;
const CACHE_VARY = ['Accept-Language', 'Accept-Encoding'] as const;
// Asymmetric only: apid rejects HS* (shared-secret) algorithms for JWT rules.
const ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'] as const;

const required = (value: string | undefined, field: string, message: string) =>
  value?.trim() ? {} : { [field]: message };

const between = (n: number | undefined, min: number, max: number) =>
  n !== undefined && Number.isInteger(n) && n >= min && n <= max;

/** A respond body whose text does not parse: refused locally, never sent. */
const INVALID_JSON: unknown = Object.freeze({ invalidJson: true });

const bytes = (n: number | undefined) =>
  n == null ? '—' : n >= 1e6 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;

export const KINDS = {
  route: def<'route'>({
    label: 'Route to an app',
    desc: 'Send matching traffic to a different app on the account.',
    empty: () => ({ target_app_slug: '' }),
    summary: (a) => `→ ${a.target_app_slug || '—'}`,
    validate: (a) => required(a.target_app_slug, 'target_app_slug', 'Pick an app.'),
    Form: ({ value, onChange, errors, apps }) => (
      <SelectField
        label="Target app"
        hint="Where matching requests are sent."
        error={errors.target_app_slug}
        value={value.target_app_slug}
        onChange={(target_app_slug) => onChange({ target_app_slug })}
        options={[
          { value: '', label: 'Pick an app…' },
          ...apps.map((a) => ({ value: a.slug, label: a.slug })),
        ]}
      />
    ),
  }),

  rewrite: def<'rewrite'>({
    label: 'Rewrite the path',
    desc: 'Change the path before the app sees it. The client URL is unchanged.',
    empty: () => ({ from: '/', to: '/' }),
    summary: (a) => `${a.from} → ${a.to}`,
    validate: (a) => ({
      ...required(a.from, 'from', 'Required.'),
      ...required(a.to, 'to', 'Required.'),
    }),
    Form: ({ value, onChange, errors }) => (
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="From"
          hint="The prefix to replace."
          error={errors.from}
          value={value.from}
          onChange={(from) => onChange({ ...value, from })}
          placeholder="/api"
        />
        <TextField
          label="To"
          hint="What it becomes."
          error={errors.to}
          value={value.to}
          onChange={(to) => onChange({ ...value, to })}
          placeholder="/v1"
        />
      </div>
    ),
  }),

  redirect: def<'redirect'>({
    label: 'Redirect',
    desc: 'Answer with a 3xx and a Location header. The app is never reached.',
    empty: () => ({ status_code: 308, to: '' }),
    summary: (a) => `${a.status_code} → ${a.to || '—'}`,
    validate: (a) => required(a.to, 'to', 'Where should it redirect?'),
    Form: ({ value, onChange, errors }) => (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <SelectField
            label="Status"
            value={String(value.status_code)}
            onChange={(v) =>
              onChange({
                ...value,
                status_code: Number(v) as S['EdgeRuleRedirectAction']['status_code'],
              })
            }
            options={[
              { value: '308', label: '308 permanent' },
              { value: '301', label: '301 permanent (legacy)' },
              { value: '307', label: '307 temporary' },
              { value: '302', label: '302 temporary (legacy)' },
            ]}
          />
          <TextField
            label="To"
            hint="Absolute URL or a path on this host."
            error={errors.to}
            value={value.to}
            onChange={(to) => onChange({ ...value, to })}
            placeholder="https://example.com/new"
          />
        </div>
        <KeyValueField
          label="Extra headers"
          hint="Sent with the redirect. Optional."
          value={value.headers ?? {}}
          onChange={(headers) => onChange({ ...value, headers })}
        />
      </div>
    ),
  }),

  headers: def<'headers'>({
    label: 'Add or strip headers',
    desc: 'Rewrite headers on the way in, on the way out, or both.',
    empty: () => ({ request_headers: [], response_headers: [] }),
    summary: (a) => {
      const req = a.request_headers?.length ?? 0;
      const res = a.response_headers?.length ?? 0;
      return `${req} request · ${res} response`;
    },
    validate: (a): Record<string, string> =>
      [...(a.request_headers ?? []), ...(a.response_headers ?? [])].some((op) => !op.name.trim())
        ? { request_headers: 'Every operation needs a header name.' }
        : {},
    Form: ({ value, onChange, errors }) => (
      <div className="flex flex-col gap-4">
        <HeaderOpsField
          label="Request headers"
          hint="Applied before the app sees the request."
          error={errors.request_headers}
          value={(value.request_headers ?? []) as HeaderOp[]}
          onChange={(request_headers) => onChange({ ...value, request_headers })}
        />
        <HeaderOpsField
          label="Response headers"
          hint="Applied to what the app returns."
          error={errors.response_headers}
          value={(value.response_headers ?? []) as HeaderOp[]}
          onChange={(response_headers) => onChange({ ...value, response_headers })}
        />
      </div>
    ),
  }),

  cors: def<'cors'>({
    label: 'CORS',
    desc: 'Answer preflights and set the access-control headers at the edge.',
    empty: () => ({ allow_origins: [], allow_methods: ['GET'], allow_credentials: false }),
    summary: (a) =>
      a.cors_preset_id
        ? 'from a preset'
        : `${a.allow_origins.length || 'no'} origin${a.allow_origins.length === 1 ? '' : 's'} · ${a.allow_methods.join('/') || 'no methods'}`,
    // A preset IS the whole policy: the API requires every inline field to be
    // empty when `cors_preset_id` is set and rejects the pair with a 422
    // otherwise, so these rules apply only to a rule carrying its own values.
    validate: (a) =>
      a.cors_preset_id
        ? {}
        : {
            ...(a.allow_origins.length ? {} : { allow_origins: 'At least one origin.' }),
            ...(a.allow_methods.length ? {} : { allow_methods: 'At least one method.' }),
            ...(a.allow_credentials && a.allow_origins.includes('*')
              ? { allow_credentials: 'Credentials cannot be sent to a wildcard origin.' }
              : {}),
          },
    Form: ({ value, onChange, errors, slug }) => (
      <div className="flex flex-col gap-4">
        <CorsPresetPicker
          slug={slug}
          value={value.cors_preset_id ?? null}
          onPick={(preset) =>
            onChange(
              preset
                ? // Reference only. The API refuses a rule that carries both a
                  // preset and inline values, so picking one clears them.
                  {
                    cors_preset_id: preset.id,
                    allow_origins: [],
                    allow_methods: [],
                    allow_headers: [],
                    expose_headers: [],
                    allow_credentials: false,
                  }
                : { ...value, cors_preset_id: null, allow_methods: ['GET'] }
            )
          }
        />
        {value.cors_preset_id ? (
          <p className="text-xs text-muted-foreground">
            This rule serves the preset's policy. Clear the preset to set origins and methods here.
          </p>
        ) : (
          <>
            <StringListField
              label="Allowed origins"
              hint="Full origins, or * for any. Enter or comma to add."
              error={errors.allow_origins}
              value={value.allow_origins}
              onChange={(allow_origins) => onChange({ ...value, allow_origins })}
              placeholder="https://app.example.com"
            />
            <ChipSet
              label="Allowed methods"
              error={errors.allow_methods}
              options={METHODS}
              value={value.allow_methods as (typeof METHODS)[number][]}
              onChange={(allow_methods) => onChange({ ...value, allow_methods })}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <StringListField
                label="Allowed headers"
                hint="Optional. Empty means the safelisted ones."
                value={value.allow_headers ?? []}
                onChange={(allow_headers) => onChange({ ...value, allow_headers })}
                placeholder="Authorization"
              />
              <StringListField
                label="Exposed headers"
                hint="Optional. Headers the browser may read."
                value={value.expose_headers ?? []}
                onChange={(expose_headers) => onChange({ ...value, expose_headers })}
                placeholder="X-Request-Id"
              />
            </div>
            <NumberField
              label="Max age (seconds)"
              hint="How long a browser may cache the preflight."
              value={value.max_age_seconds}
              onChange={(max_age_seconds) => onChange({ ...value, max_age_seconds })}
              className="sm:w-56"
            />
            <div className="border-t border-border">
              <ToggleRow
                label="Allow credentials"
                hint="Lets the browser send cookies and Authorization. Not valid with a wildcard origin."
                checked={value.allow_credentials ?? false}
                onChange={(allow_credentials) => onChange({ ...value, allow_credentials })}
              />
            </div>
            {errors.allow_credentials && (
              <p className="text-xs" style={{ color: 'var(--status-critical)' }} role="alert">
                {errors.allow_credentials}
              </p>
            )}
          </>
        )}
      </div>
    ),
  }),

  jwt: def<'jwt'>({
    label: 'Verify a JWT',
    desc: 'Reject requests without a valid token before they reach the app.',
    paid: true,
    empty: () => ({ issuer: '', jwks_url: '', algorithms: ['RS256'] }),
    summary: (a) => `${a.issuer || '—'} · ${a.algorithms.join('/')}`,
    validate: (a) => ({
      ...required(a.issuer, 'issuer', 'Required.'),
      ...required(a.jwks_url, 'jwks_url', 'Required.'),
      ...(a.algorithms.length ? {} : { algorithms: 'Pick at least one algorithm.' }),
    }),
    Form: ({ value, onChange, errors }) => (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Issuer"
            hint="The iss claim to require."
            error={errors.issuer}
            value={value.issuer}
            onChange={(issuer) => onChange({ ...value, issuer })}
            placeholder="https://auth.example.com/"
          />
          <TextField
            label="JWKS URL"
            hint="Where the signing keys are fetched from."
            error={errors.jwks_url}
            value={value.jwks_url}
            onChange={(jwks_url) => onChange({ ...value, jwks_url })}
            placeholder="https://auth.example.com/.well-known/jwks.json"
          />
        </div>
        <ChipSet
          label="Algorithms"
          hint="Only these are accepted — an empty set would accept none."
          error={errors.algorithms}
          options={ALGORITHMS}
          value={value.algorithms}
          onChange={(algorithms) => onChange({ ...value, algorithms })}
        />
        <StringListField
          label="Audience"
          hint="Optional. Any one of these satisfies the aud claim."
          value={value.audience ?? []}
          onChange={(audience) => onChange({ ...value, audience })}
          placeholder="api.example.com"
        />
        <KeyValueField
          label="Required claims"
          hint="Optional. Each must be present with this exact value."
          value={value.required_claims ?? {}}
          onChange={(required_claims) => onChange({ ...value, required_claims })}
          keyPlaceholder="scope"
          valuePlaceholder="admin"
        />
      </div>
    ),
  }),

  ip: def<'ip'>({
    label: 'IP allow or deny',
    desc: 'Filter by source address before the request is routed.',
    paid: true,
    empty: () => ({ allow: [], deny: [] }),
    summary: (a) => `${a.allow?.length ?? 0} allowed · ${a.deny?.length ?? 0} denied`,
    validate: (a): Record<string, string> => {
      const bad = [...(a.allow ?? []), ...(a.deny ?? [])].find(
        (c) => !/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$|^[0-9a-f:]+(\/\d{1,3})?$/i.test(c)
      );
      if (bad) return { allow: `${bad} is not an address or CIDR.` };
      return (a.allow?.length ?? 0) + (a.deny?.length ?? 0) === 0
        ? { allow: 'Add at least one address.' }
        : {};
    },
    Form: ({ value, onChange, errors }) => (
      <div className="grid gap-4 sm:grid-cols-2">
        <LinesField
          label="Allow"
          hint="One address or CIDR per line. If any are listed, everything else is denied."
          error={errors.allow}
          value={value.allow ?? []}
          onChange={(allow) => onChange({ ...value, allow })}
          placeholder={'10.0.0.0/8\n203.0.113.4'}
        />
        <LinesField
          label="Deny"
          hint="Checked first. One per line."
          error={errors.deny}
          value={value.deny ?? []}
          onChange={(deny) => onChange({ ...value, deny })}
          placeholder="198.51.100.0/24"
        />
      </div>
    ),
  }),

  validate: def<'validate'>({
    label: 'Validate the body',
    desc: 'Reject requests whose JSON body does not match a schema.',
    empty: () => ({ schema: { type: 'object' }, validate_mode: 'block' }),
    // A rule may carry `parameters` instead of a body schema (set outside this
    // form); it is shown and kept, never replaced with an empty schema.
    summary: (a) =>
      a.schema
        ? `${Object.keys((a.schema.properties as object) ?? {}).length || '—'} properties${a.reject_on_unknown_fields ? ' · strict' : ''}`
        : 'Parameter rules only',
    validate: (a): Record<string, string> =>
      (a.schema && typeof a.schema === 'object') || a.parameters
        ? {}
        : { schema: 'A JSON object is required.' },
    Form: ({ value, onChange, errors }) => (
      <div className="flex flex-col gap-4">
        <JsonField
          label="JSON Schema"
          hint="Applied to the request body. Draft 2020-12."
          error={errors.schema}
          value={value.schema ?? {}}
          onChange={(schema) => onChange({ ...value, schema: schema ?? value.schema })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <StringListField
            label="Content types"
            hint="Optional. Empty means application/json."
            value={value.content_types ?? []}
            onChange={(content_types) => onChange({ ...value, content_types })}
            placeholder="application/json"
          />
          <NumberField
            label="Max body bytes"
            hint="Optional ceiling before validation runs."
            value={value.max_body_bytes}
            onChange={(max_body_bytes) => onChange({ ...value, max_body_bytes })}
          />
        </div>
        <div className="divide-y divide-border border-t border-border">
          <ToggleRow
            label="Reject unknown fields"
            hint="Anything not named by the schema fails the request."
            checked={value.reject_on_unknown_fields ?? false}
            onChange={(reject_on_unknown_fields) =>
              onChange({ ...value, reject_on_unknown_fields })
            }
          />
          <ToggleRow
            label="Apply while streaming"
            hint="Validate a streamed body as it arrives, rather than skipping it."
            checked={value.apply_while_streaming ?? false}
            onChange={(apply_while_streaming) => onChange({ ...value, apply_while_streaming })}
          />
        </div>
      </div>
    ),
  }),

  limit: def<'limit'>({
    label: 'Body size limit',
    desc: 'Reject requests with a body over a fixed size.',
    empty: () => ({ max_body_bytes: 1048576 }),
    summary: (a) => `≤ ${bytes(a.max_body_bytes)}`,
    validate: (a): Record<string, string> =>
      a.max_body_bytes > 0 ? {} : { max_body_bytes: 'Must be more than zero.' },
    Form: ({ value, onChange, errors }) => (
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Max body bytes"
          hint={`${bytes(value.max_body_bytes)}. 1 MB is 1048576.`}
          error={errors.max_body_bytes}
          value={value.max_body_bytes}
          min={1}
          onChange={(max_body_bytes) => onChange({ ...value, max_body_bytes: max_body_bytes ?? 0 })}
        />
        <NumberField
          label="Streaming limit"
          hint="Optional, for streamed bodies."
          value={value.max_body_bytes_streaming}
          onChange={(max_body_bytes_streaming) => onChange({ ...value, max_body_bytes_streaming })}
        />
      </div>
    ),
  }),

  maintenance: def<'maintenance'>({
    label: 'Maintenance page',
    desc: 'Answer everything matching with a 503 and a message.',
    empty: () => ({ retry_after_seconds: 300, message: '' }),
    summary: (a) => a.message?.trim() || `503 · retry after ${a.retry_after_seconds ?? 0}s`,
    validate: () => ({}),
    Form: ({ value, onChange }) => (
      <div className="flex flex-col gap-4">
        <NumberField
          label="Retry after (seconds)"
          hint="Sent as the Retry-After header."
          value={value.retry_after_seconds}
          onChange={(retry_after_seconds) => onChange({ ...value, retry_after_seconds })}
          className="sm:w-56"
        />
        <TextField
          label="Message"
          hint="Shown to the caller. Optional."
          mono={false}
          value={value.message ?? ''}
          onChange={(message) => onChange({ ...value, message })}
          placeholder="Back at 14:00 UTC."
        />
      </div>
    ),
  }),

  geo: def<'geo'>({
    label: 'Country allow or deny',
    desc: 'Filter by the country the request came from.',
    empty: () => ({ allow: [], deny: [] }),
    summary: (a) =>
      a.allow?.length
        ? `only ${a.allow.join(', ')}`
        : a.deny?.length
          ? `not ${a.deny.join(', ')}`
          : 'no countries',
    validate: (a): Record<string, string> => {
      const bad = [...(a.allow ?? []), ...(a.deny ?? [])].find((c) => !/^[A-Z]{2}$/.test(c));
      if (bad) return { allow: `${bad} is not a two-letter country code.` };
      return (a.allow?.length ?? 0) + (a.deny?.length ?? 0) === 0
        ? { allow: 'Add at least one country.' }
        : {};
    },
    Form: ({ value, onChange, errors }) => (
      <div className="grid gap-4 sm:grid-cols-2">
        <StringListField
          label="Allow"
          hint="ISO 3166-1 alpha-2. If any are listed, everywhere else is denied."
          error={errors.allow}
          value={value.allow ?? []}
          onChange={(allow) => onChange({ ...value, allow })}
          placeholder="DE"
          normalize={(s) => s.toUpperCase()}
        />
        <StringListField
          label="Deny"
          hint="Checked first."
          error={errors.deny}
          value={value.deny ?? []}
          onChange={(deny) => onChange({ ...value, deny })}
          placeholder="RU"
          normalize={(s) => s.toUpperCase()}
        />
      </div>
    ),
  }),

  throttle: def<'throttle'>({
    label: 'Rate limit',
    desc: 'Shed traffic over a rate, with a burst allowance.',
    empty: () => ({ requests_per_second: 10, burst: 20, key_by: 'none', max_keys_per_rule: 0 }),
    summary: (a) => `${a.requests_per_second} rps · burst ${a.burst}`,
    validate: (a) => ({
      ...(a.requests_per_second > 0 ? {} : { requests_per_second: 'Must be more than zero.' }),
      ...(a.burst >= a.requests_per_second
        ? {}
        : { burst: 'Burst below the rate would reject traffic the rate allows.' }),
    }),
    Form: ({ value, onChange, errors, suggest }) => (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            label="Requests per second"
            error={errors.requests_per_second}
            value={value.requests_per_second}
            min={1}
            onChange={(v) => onChange({ ...value, requests_per_second: v ?? 0 })}
          />
          <NumberField
            label="Burst"
            hint="Requests allowed to arrive at once before shedding."
            error={errors.burst}
            value={value.burst}
            min={1}
            onChange={(v) => onChange({ ...value, burst: v ?? 0 })}
          />
        </div>
        {suggest}
      </div>
    ),
  }),

  budget: def<'budget'>({
    label: 'Time budget',
    desc: 'Give the request a deadline; the edge gives up when it passes.',
    empty: () => ({ budget_ms: 5000 }),
    summary: (a) => `${a.budget_ms} ms`,
    validate: (a): Record<string, string> =>
      a.budget_ms > 0 ? {} : { budget_ms: 'Must be more than zero.' },
    Form: ({ value, onChange, errors }) => (
      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField
          label="Budget (ms)"
          hint="Wall clock, including a cold wake."
          error={errors.budget_ms}
          value={value.budget_ms}
          min={1}
          onChange={(budget_ms) => onChange({ ...value, budget_ms: budget_ms ?? 0 })}
        />
        <TextField
          label="Override header"
          hint="Optional. A request carrying it may ask for longer."
          value={value.allow_override_header ?? ''}
          onChange={(allow_override_header) => onChange({ ...value, allow_override_header })}
          placeholder="X-Budget-Ms"
        />
      </div>
    ),
  }),
  cache: def<'cache'>({
    label: 'Response cache',
    desc: 'Serve repeat GET and HEAD requests from the edge within a reviewed freshness window.',
    paid: true,
    empty: () => ({
      max_age_seconds: 60,
      stale_while_revalidate_seconds: 0,
      stale_if_error_seconds: 300,
      methods: ['GET', 'HEAD'],
      vary_on: [],
    }),
    summary: (a) =>
      `fresh ${a.max_age_seconds} s · revalidate ${a.stale_while_revalidate_seconds ?? 0} s · error ${a.stale_if_error_seconds} s`,
    validate: validateCacheAction,
    Form: ({ value, onChange, errors }) => (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField
            label="Fresh for (seconds)"
            hint="0 uses the server default of 60; maximum 3600."
            error={errors.max_age_seconds}
            value={value.max_age_seconds}
            emptyWhenNegative
            onChange={(max_age_seconds) =>
              onChange({ ...value, max_age_seconds: max_age_seconds ?? -1 })
            }
          />
          <NumberField
            label="Stale while revalidate (seconds)"
            hint="0 disables background refresh; maximum 300."
            error={errors.stale_while_revalidate_seconds}
            value={value.stale_while_revalidate_seconds ?? 0}
            emptyWhenNegative
            onChange={(stale_while_revalidate_seconds) =>
              onChange({
                ...value,
                stale_while_revalidate_seconds: stale_while_revalidate_seconds ?? -1,
              })
            }
          />
          <NumberField
            label="Stale if error (seconds)"
            hint="0 disables stale responses on upstream errors; maximum 300."
            error={errors.stale_if_error_seconds}
            value={value.stale_if_error_seconds}
            emptyWhenNegative
            onChange={(stale_if_error_seconds) =>
              onChange({ ...value, stale_if_error_seconds: stale_if_error_seconds ?? -1 })
            }
          />
        </div>
        <ChipSet
          label="Cache methods"
          hint="Only GET and HEAD responses may be cached."
          error={errors.methods}
          options={CACHE_METHODS}
          value={value.methods ?? []}
          onChange={(methods) => onChange({ ...value, methods })}
        />
        <ChipSet
          label="Vary on"
          hint="Only these non-credential request headers can split cache entries."
          error={errors.vary_on}
          options={CACHE_VARY}
          value={value.vary_on ?? []}
          onChange={(vary_on) => onChange({ ...value, vary_on })}
        />
        <p className="text-xs text-muted-foreground">
          Requests with Authorization or Cookie bypass the cache. Responses with Set-Cookie,
          Cache-Control: private, or no-store are never stored.
        </p>
      </div>
    ),
  }),

  // limits.go:7587-7594: difficulty 10..22 (default 16), pass 300..86400 s.
  challenge: def<'challenge'>({
    label: 'Browser challenge',
    desc: 'Browsers solve a short proof of work before reaching the app. Verified crawlers and requests with a verified API key or JWT pass; scripts get 403.',
    paid: true,
    empty: () => ({ difficulty: 16, pass_ttl_seconds: 3600 }),
    summary: (a) => {
      const d = a.difficulty ?? 16;
      const max = a.max_difficulty && a.max_difficulty > d ? `–${a.max_difficulty}` : '';
      return `difficulty ${d}${max} · pass ${Math.round((a.pass_ttl_seconds ?? 3600) / 60)} min`;
    },
    validate: (a) => {
      const d = a.difficulty ?? 16;
      const ttl = a.pass_ttl_seconds ?? 3600;
      return {
        ...(Number.isInteger(d) && d >= 10 && d <= 22 ? {} : { difficulty: 'From 10 to 22.' }),
        ...(Number.isInteger(ttl) && ttl >= 300 && ttl <= 86400
          ? {}
          : { pass_ttl_seconds: 'From 300 to 86400 seconds.' }),
        ...(a.max_difficulty === undefined ||
        (Number.isInteger(a.max_difficulty) && a.max_difficulty >= d && a.max_difficulty <= 22)
          ? {}
          : { max_difficulty: 'From the difficulty up to 22.' }),
      };
    },
    Form: ({ value, onChange, errors }) => (
      <div className="grid gap-4 sm:grid-cols-3">
        <NumberField
          label="Difficulty (bits)"
          hint="Each extra bit doubles the work. 16 takes a phone about a second."
          error={errors.difficulty}
          value={value.difficulty}
          min={10}
          onChange={(difficulty) => onChange({ ...value, difficulty })}
        />
        <NumberField
          label="Raise up to (bits)"
          hint="Optional. Under attack the gateway raises the difficulty to this, and lowers it again."
          error={errors.max_difficulty}
          value={value.max_difficulty}
          min={10}
          onChange={(max_difficulty) => onChange({ ...value, max_difficulty })}
        />
        <NumberField
          label="Pass lasts (seconds)"
          hint="How long a solved challenge lets the browser through. 300 to 86400."
          error={errors.pass_ttl_seconds}
          value={value.pass_ttl_seconds}
          min={300}
          onChange={(pass_ttl_seconds) => onChange({ ...value, pass_ttl_seconds })}
        />
      </div>
    ),
  }),
  // edge_rule.waf is the edge-protection capability; WAF rules are Pro and
  // Scale only (docs/edge-rules.md §Limits: 0 on Free and Hobby).
  waf: def<'waf'>({
    label: 'Web application firewall',
    desc: 'Inspect requests with the OWASP Core Rule Set. Observe reports detections; warn tags the response; block answers 403.',
    paid: true,
    plans: ['pro', 'scale'],
    capability: 'edge-protection',
    empty: () => ({
      mode: 'observe',
      paranoia_level: 1,
      anomaly_threshold: 5,
      exclude_rule_ids: [],
      inspect_body_bytes: 8192,
    }),
    summary: (a) =>
      `${a.mode ?? 'observe'} · paranoia ${a.paranoia_level ?? 1} · threshold ${a.anomaly_threshold ?? 5}${
        a.exclude_rule_ids?.length ? ` · ${a.exclude_rule_ids.length} excluded` : ''
      }`,
    validate: (a): Record<string, string> => ({
      ...(a.paranoia_level === undefined || a.paranoia_level === 1 || a.paranoia_level === 2
        ? {}
        : { paranoia_level: 'Level 1 or 2.' }),
      ...((a.mode === 'warn' || a.mode === 'block') && (a.paranoia_level ?? 1) !== 1
        ? { paranoia_level: 'Warn and block run at paranoia level 1 only.' }
        : {}),
      ...(a.anomaly_threshold === undefined || between(a.anomaly_threshold, 1, 100)
        ? {}
        : { anomaly_threshold: 'From 1 to 100.' }),
      ...(a.inspect_body_bytes === undefined || between(a.inspect_body_bytes, 1, 65536)
        ? {}
        : { inspect_body_bytes: 'From 1 to 65536 bytes.' }),
      ...((a.exclude_rule_ids ?? []).length > 50
        ? { exclude_rule_ids: 'At most 50 rule IDs.' }
        : (a.exclude_rule_ids ?? []).every((id) => between(id, 900000, 999999))
          ? {}
          : { exclude_rule_ids: 'CRS rule IDs run from 900000 to 999999.' }),
    }),
    Form: ({ value, onChange, errors, wafBlocking }) => {
      const mode = value.mode ?? 'observe';
      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Mode</span>
            <SegmentedControl
              label="WAF mode"
              value={mode}
              options={[
                { key: 'observe', label: 'Observe' },
                ...(wafBlocking || mode !== 'observe'
                  ? [
                      { key: 'warn' as const, label: 'Warn' },
                      { key: 'block' as const, label: 'Block' },
                    ]
                  : []),
              ]}
              onChange={(next) =>
                onChange({
                  ...value,
                  mode: next,
                  ...(next !== 'observe' ? { paranoia_level: 1 } : {}),
                })
              }
            />
            <span className="text-xs text-muted-foreground">
              {!wafBlocking
                ? 'Warn and block are not released to this account yet; until they are, a rule only observes.'
                : mode === 'observe'
                  ? 'Samples requests, bodies included, off the request path and reports detections. Nothing is blocked.'
                  : mode === 'warn'
                    ? 'Also checks headers and URL in the request path: a detected request is served with an X-WAF-Warning response header.'
                    : 'Also checks headers and URL in the request path: a detected request is answered 403. Bodies are never blocked.'}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <SelectField
              label="Paranoia level"
              hint="Level 2 detects more and flags more legitimate traffic. Observe only."
              error={errors.paranoia_level}
              value={String(value.paranoia_level ?? 1)}
              onChange={(v) => onChange({ ...value, paranoia_level: Number(v) })}
              options={[
                { value: '1', label: '1' },
                ...(mode === 'observe' ? [{ value: '2', label: '2' }] : []),
              ]}
            />
            <NumberField
              label="Anomaly threshold"
              hint="Score at which a request counts as a detection; one critical match scores 5."
              error={errors.anomaly_threshold}
              value={value.anomaly_threshold}
              min={1}
              onChange={(anomaly_threshold) => onChange({ ...value, anomaly_threshold })}
            />
            <NumberField
              label="Inspect body (bytes)"
              hint="Body prefix inspected, up to 65536. Larger uses more of the app's budget."
              error={errors.inspect_body_bytes}
              value={value.inspect_body_bytes}
              min={1}
              onChange={(inspect_body_bytes) => onChange({ ...value, inspect_body_bytes })}
            />
          </div>
          <StringListField
            label="Excluded CRS rules"
            hint="Rule IDs left out of scoring on this route, for known false positives. The WAF review can add them for you."
            error={errors.exclude_rule_ids}
            value={(value.exclude_rule_ids ?? []).map(String)}
            onChange={(ids) =>
              onChange({ ...value, exclude_rule_ids: ids.map(Number).filter(Number.isFinite) })
            }
            placeholder="942100"
            normalize={(s) => s.replace(/\D/g, '')}
          />
        </div>
      );
    },
  }),

  // edge_rule.retry is the request-retry capability, released per account
  // (docs/edge-rules.md: "on request"); Free has a quota of 0.
  retry: def<'retry'>({
    label: 'Retry on another instance',
    desc: 'Replay a request that failed in transport on a healthy sibling. An app that answered 5xx is never replayed.',
    paid: true,
    capability: 'request-retry',
    stage: 'on request',
    empty: () => ({
      max_attempts: 2,
      allow_non_idempotent: false,
      min_remaining_ms: 250,
      backoff_ms: 0,
      budget_percent: 10,
      budget_min_retries: 1,
    }),
    summary: (a) =>
      `${a.max_attempts ?? 2} attempts · budget ${a.budget_percent ?? 10}%${a.allow_non_idempotent ? ' · POST/PATCH with key' : ''}`,
    validate: (a): Record<string, string> => ({
      ...(a.max_attempts === undefined || a.max_attempts === 2 || a.max_attempts === 3
        ? {}
        : { max_attempts: '2 or 3. It counts attempts, not retries: 2 is one replay.' }),
      ...(a.min_remaining_ms === undefined || between(a.min_remaining_ms, 0, 30000)
        ? {}
        : { min_remaining_ms: 'From 0 to 30000 ms.' }),
      ...(a.backoff_ms === undefined || between(a.backoff_ms, 0, 1000)
        ? {}
        : { backoff_ms: 'From 0 to 1000 ms.' }),
      ...(a.budget_percent === undefined || between(a.budget_percent, 1, 100)
        ? {}
        : { budget_percent: 'From 1 to 100.' }),
      ...(a.budget_min_retries === undefined || between(a.budget_min_retries, 0, 32)
        ? {}
        : { budget_min_retries: 'From 0 to 32.' }),
    }),
    Form: ({ value, onChange, errors }) => (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <SelectField
            label="Attempts"
            hint="Counts the original: 2 is one replay."
            error={errors.max_attempts}
            value={String(value.max_attempts ?? 2)}
            onChange={(v) => onChange({ ...value, max_attempts: Number(v) })}
            options={[
              { value: '2', label: '2' },
              { value: '3', label: '3' },
            ]}
          />
          <NumberField
            label="Budget (% of requests)"
            hint="At most this share of the app's requests is replayed, so an outage cannot double traffic."
            error={errors.budget_percent}
            value={value.budget_percent}
            min={1}
            onChange={(budget_percent) => onChange({ ...value, budget_percent })}
          />
          <NumberField
            label="Minimum replays"
            hint="Per window, so a quiet app keeps one recovery chance. 0 to 32."
            error={errors.budget_min_retries}
            value={value.budget_min_retries}
            onChange={(budget_min_retries) => onChange({ ...value, budget_min_retries })}
          />
          <NumberField
            label="Minimum time left (ms)"
            hint="Skip the replay when less of the request budget remains. 0 uses 250."
            error={errors.min_remaining_ms}
            value={value.min_remaining_ms}
            onChange={(min_remaining_ms) => onChange({ ...value, min_remaining_ms })}
          />
          <NumberField
            label="Backoff (ms)"
            hint="Delay before the replay, up to 1000. The next instance is a different process, so 0 is usual."
            error={errors.backoff_ms}
            value={value.backoff_ms}
            onChange={(backoff_ms) => onChange({ ...value, backoff_ms })}
          />
        </div>
        <div className="border-t border-border">
          <ToggleRow
            label="Replay POST and PATCH"
            hint="Only requests carrying an Idempotency-Key header, and only if your handler returns the stored result for a repeated key; otherwise the side effect runs twice."
            checked={value.allow_non_idempotent ?? false}
            onChange={(allow_non_idempotent) => onChange({ ...value, allow_non_idempotent })}
          />
        </div>
      </div>
    ),
  }),

  // edge_rule.circuit_breaker is the circuit-breaking capability, released
  // per account; Free has a quota of 0. It tunes a breaker every app has.
  circuit_breaker: def<'circuit_breaker'>({
    label: 'Circuit breaker',
    desc: 'Tune when a failing instance is taken out of rotation. Every app already has a breaker; this changes its thresholds.',
    paid: true,
    capability: 'circuit-breaking',
    stage: 'on request',
    empty: () => ({
      failure_threshold: 0.5,
      min_requests: 5,
      window_seconds: 10,
      open_seconds: 5,
      max_open_seconds: 60,
    }),
    summary: (a) =>
      `${Math.round((a.failure_threshold ?? 0.5) * 100)}% of ${a.min_requests ?? 5} in ${a.window_seconds ?? 10} s · open ${a.open_seconds ?? 5}–${a.max_open_seconds ?? 60} s`,
    validate: (a): Record<string, string> => ({
      ...(a.failure_threshold === undefined || (a.failure_threshold > 0 && a.failure_threshold <= 1)
        ? {}
        : { failure_threshold: 'A ratio above 0 and at most 1, such as 0.5.' }),
      ...(a.min_requests === undefined || between(a.min_requests, 1, 1000)
        ? {}
        : { min_requests: 'From 1 to 1000.' }),
      ...(a.window_seconds === undefined || between(a.window_seconds, 1, 300)
        ? {}
        : { window_seconds: 'From 1 to 300 seconds.' }),
      ...(a.open_seconds === undefined || between(a.open_seconds, 1, 3600)
        ? {}
        : { open_seconds: 'From 1 to 3600 seconds.' }),
      ...(a.max_open_seconds === undefined ||
      (between(a.max_open_seconds, 1, 3600) && a.max_open_seconds >= (a.open_seconds ?? 5))
        ? {}
        : { max_open_seconds: 'From the first open interval up to 3600 seconds.' }),
    }),
    Form: ({ value, onChange, errors }) => (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="Failure ratio"
            hint="Opens at or above this share of failures, 0 to 1. 0.5 is half."
            error={errors.failure_threshold}
            value={value.failure_threshold === undefined ? '' : String(value.failure_threshold)}
            onChange={(v) =>
              onChange({ ...value, failure_threshold: v.trim() === '' ? undefined : Number(v) })
            }
            placeholder="0.5"
          />
          <NumberField
            label="Minimum requests"
            hint="Observations in the window before the ratio counts. At 1, one blip opens it."
            error={errors.min_requests}
            value={value.min_requests}
            min={1}
            onChange={(min_requests) => onChange({ ...value, min_requests })}
          />
          <NumberField
            label="Window (seconds)"
            hint="Rolling failure window, up to 300."
            error={errors.window_seconds}
            value={value.window_seconds}
            min={1}
            onChange={(window_seconds) => onChange({ ...value, window_seconds })}
          />
          <NumberField
            label="First open (seconds)"
            hint="Before one probe request is let through. Doubles after each failed probe."
            error={errors.open_seconds}
            value={value.open_seconds}
            min={1}
            onChange={(open_seconds) => onChange({ ...value, open_seconds })}
          />
          <NumberField
            label="Longest open (seconds)"
            hint="The ceiling the doubling grows to, up to 3600."
            error={errors.max_open_seconds}
            value={value.max_open_seconds}
            min={1}
            onChange={(max_open_seconds) => onChange({ ...value, max_open_seconds })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          The breaker is per app: the highest-priority rule tunes it for every instance, whatever
          its path. A change reaches the gateways within 30 seconds.
        </p>
      </div>
    ),
  }),

  // edge_rule.async is the async-routes capability (preview); Free plans
  // cannot invoke asynchronously (edgerules/rules_core.go:103).
  async: def<'async'>({
    label: 'Run asynchronously',
    desc: 'Accept the request with 202 and a status URL, store it, and run it later without keeping the caller waiting.',
    paid: true,
    capability: 'async-routes',
    stage: 'preview',
    empty: () => ({}),
    summary: (a) => {
      const attempts = a.retry_policy?.max_attempts;
      return [
        '202 accepted',
        attempts ? `${attempts} attempts` : '',
        a.max_age_seconds ? `max age ${a.max_age_seconds} s` : '',
        a.on_success || a.on_failure ? 'webhooks' : '',
      ]
        .filter(Boolean)
        .join(' · ');
    },
    validate: (a): Record<string, string> => {
      const r = a.retry_policy ?? {};
      return {
        ...(a.max_age_seconds === undefined || between(a.max_age_seconds, 0, 86400)
          ? {}
          : { max_age_seconds: 'From 0 to 86400 seconds.' }),
        ...(r.max_attempts === undefined || between(r.max_attempts, 0, 25)
          ? {}
          : { 'retry_policy.max_attempts': 'From 0 to 25.' }),
        ...(r.jitter_seconds === undefined ||
        (Number.isFinite(r.jitter_seconds) && r.jitter_seconds >= 0 && r.jitter_seconds <= 1)
          ? {}
          : { 'retry_policy.jitter_seconds': 'A fraction from 0 to 1.' }),
        ...(r.base_seconds !== undefined && !(r.base_seconds >= 0)
          ? { 'retry_policy.base_seconds': 'Zero or more seconds.' }
          : {}),
        ...(r.max_seconds !== undefined &&
        (!(r.max_seconds >= 0) ||
          ((r.base_seconds ?? 0) > 0 && r.max_seconds > 0 && r.max_seconds < (r.base_seconds ?? 0)))
          ? { 'retry_policy.max_seconds': 'At least the base delay.' }
          : {}),
      };
    },
    Form: ({ value, onChange, errors, slug }) => {
      const retry = value.retry_policy ?? {};
      const setRetry = (patch: Partial<NonNullable<typeof value.retry_policy>>) => {
        const next: Record<string, number | undefined> = { ...retry, ...patch };
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
        onChange({ ...value, retry_policy: Object.keys(next).length ? next : undefined });
      };
      const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
      return (
        <div className="flex flex-col gap-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            The app receives the original method, path, JSON body and safe headers later; its
            workload has to accept request invocations. Empty fields keep the app and plan defaults.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <WebhookSelect
              slug={slug}
              label="On success"
              hint="A webhook subscription of this app that receives the job.finished outcome."
              value={value.on_success}
              onChange={(on_success) => onChange({ ...value, on_success })}
            />
            <WebhookSelect
              slug={slug}
              label="On failure"
              hint="Receives failed and dead-lettered outcomes."
              value={value.on_failure}
              onChange={(on_failure) => onChange({ ...value, on_failure })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField
              label="Max age (seconds)"
              hint="Lifetime from acceptance; 0 inherits the plan's deadline, which also caps it."
              error={errors.max_age_seconds}
              value={value.max_age_seconds}
              onChange={(max_age_seconds) => onChange({ ...value, max_age_seconds })}
            />
            <NumberField
              label="Attempts"
              hint="Including the first, up to 25 and your plan's cap; 0 inherits."
              error={errors['retry_policy.max_attempts']}
              value={retry.max_attempts}
              onChange={(max_attempts) => setRetry({ max_attempts })}
            />
            <TextField
              label="Jitter"
              hint="Symmetric fraction of the delay, 0 to 1."
              error={errors['retry_policy.jitter_seconds']}
              value={retry.jitter_seconds === undefined ? '' : String(retry.jitter_seconds)}
              onChange={(v) => setRetry({ jitter_seconds: num(v) })}
              placeholder="0.1"
            />
            <TextField
              label="Base delay (seconds)"
              hint="Exponential backoff starts here."
              error={errors['retry_policy.base_seconds']}
              value={retry.base_seconds === undefined ? '' : String(retry.base_seconds)}
              onChange={(v) => setRetry({ base_seconds: num(v) })}
              placeholder="1"
            />
            <TextField
              label="Max delay (seconds)"
              hint="The backoff's ceiling."
              error={errors['retry_policy.max_seconds']}
              value={retry.max_seconds === undefined ? '' : String(retry.max_seconds)}
              onChange={(v) => setRetry({ max_seconds: num(v) })}
              placeholder="60"
            />
          </div>
        </div>
      );
    },
  }),

  // Preview apps only (edgerules/rules_core.go:147); every plan.
  respond: def<'respond'>({
    label: 'Fixed response',
    desc: 'Answer with a fixed JSON body, so a preview frontend can be built before its endpoint exists.',
    empty: () => ({ status_code: 200, body: {} }),
    summary: (a) => `${a.status_code}${a.body === undefined ? ' · empty' : ' · JSON'}`,
    validate: (a): Record<string, string> => ({
      ...(between(a.status_code, 200, 599) ? {} : { status_code: 'From 200 to 599.' }),
      ...(a.body === INVALID_JSON
        ? { body: 'Fix the JSON first.' }
        : a.body !== undefined && new TextEncoder().encode(JSON.stringify(a.body)).length > 65536
          ? { body: 'At most 64 KiB.' }
          : {}),
    }),
    Form: ({ value, onChange, errors }) => (
      <div className="flex flex-col gap-4">
        <NumberField
          label="Status"
          hint="200 to 599."
          error={errors.status_code}
          value={value.status_code}
          min={200}
          onChange={(status_code) => onChange({ ...value, status_code: status_code ?? 0 })}
          className="sm:w-56"
        />
        <JsonValueField
          label="Body"
          hint="Any JSON value, up to 64 KiB. Empty sends no body."
          error={errors.body}
          value={value.body}
          onChange={(body) => onChange({ ...value, body })}
          onInvalid={() => onChange({ ...value, body: INVALID_JSON })}
        />
      </div>
    ),
  }),
} satisfies { [K in Kind]: KindDef<K> };

export const KIND_ORDER = Object.keys(KINDS) as Kind[];

/** One of the app's webhook subscriptions, by id (`GET /v1/apps/{slug}/webhooks`). */
function WebhookSelect({
  slug,
  label,
  hint,
  value,
  onChange,
}: {
  slug: string;
  label: string;
  hint: string;
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const hooks = useWebhooks(slug);
  const list = hooks.data ?? [];
  const known = !value || list.some((h) => h.id === value);
  return (
    <SelectField
      label={label}
      hint={
        hooks.error
          ? 'The app’s webhooks could not be read.'
          : hooks.isPending
            ? 'Reading the app’s webhooks…'
            : list.length
              ? hint
              : 'This app has no webhook subscriptions; add one on its Webhooks tab.'
      }
      value={value ?? ''}
      onChange={(v) => onChange(v || undefined)}
      options={[
        { value: '', label: 'None' },
        ...list.map((h) => ({ value: h.id, label: h.target_url })),
        ...(known || !value ? [] : [{ value, label: value }]),
      ]}
    />
  );
}

/** One line describing a rule's action, for the table. */
export function summarise(kind: string, action: unknown): string {
  const def = KINDS[kind as Kind];
  if (!def) return kind;
  try {
    return def.summary(action as never);
  } catch {
    // A rule made by the CLI with a shape this build does not know about.
    return '—';
  }
}
