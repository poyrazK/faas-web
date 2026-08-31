import type { ReactNode } from 'react';
import type { components } from '@/lib/api/schema';
import {
  ChipSet,
  HeaderOpsField,
  JsonField,
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
}

export interface KindDef<K extends Kind> {
  label: string;
  desc: string;
  /** Free plans get 402 for these; the picker says so before the server does. */
  paid?: boolean;
  empty: () => ActionMap[K];
  summary: (action: ActionMap[K]) => string;
  validate: (action: ActionMap[K]) => Record<string, string>;
  Form: (props: ActionFormProps<ActionMap[K]>) => ReactNode;
}

function def<K extends Kind>(d: KindDef<K>): KindDef<K> {
  return d;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
  'HS256',
  'HS384',
  'HS512',
] as const;

const required = (value: string | undefined, field: string, message: string) =>
  value?.trim() ? {} : { [field]: message };

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
      `${a.allow_origins.length || 'no'} origin${a.allow_origins.length === 1 ? '' : 's'} · ${a.allow_methods.join('/') || 'no methods'}`,
    validate: (a) => ({
      ...(a.allow_origins.length ? {} : { allow_origins: 'At least one origin.' }),
      ...(a.allow_methods.length ? {} : { allow_methods: 'At least one method.' }),
      ...(a.allow_credentials && a.allow_origins.includes('*')
        ? { allow_credentials: 'Credentials cannot be sent to a wildcard origin.' }
        : {}),
    }),
    Form: ({ value, onChange, errors }) => (
      <div className="flex flex-col gap-4">
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
            checked={value.allow_credentials}
            onChange={(allow_credentials) => onChange({ ...value, allow_credentials })}
          />
        </div>
        {errors.allow_credentials && (
          <p className="text-xs" style={{ color: 'var(--status-critical)' }} role="alert">
            {errors.allow_credentials}
          </p>
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
    // `validate_mode` on the action is the ADR-128 back-compat copy; the
    // top-level field the dialog sends is what the gateway reads.
    empty: () => ({ schema: { type: 'object' }, validate_mode: 'block' }),
    summary: (a) =>
      `${Object.keys((a.schema.properties as object) ?? {}).length || '—'} properties${a.reject_on_unknown_fields ? ' · strict' : ''}`,
    validate: (a): Record<string, string> =>
      a.schema && typeof a.schema === 'object' ? {} : { schema: 'A JSON object is required.' },
    Form: ({ value, onChange, errors }) => (
      <div className="flex flex-col gap-4">
        <JsonField
          label="JSON Schema"
          hint="Applied to the request body. Draft 2020-12."
          error={errors.schema}
          value={value.schema}
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
    empty: () => ({ requests_per_second: 10, burst: 20, key_by: '', max_keys_per_rule: 0 }),
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
} satisfies { [K in Kind]: KindDef<K> };

export const KIND_ORDER = Object.keys(KINDS) as Kind[];

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
