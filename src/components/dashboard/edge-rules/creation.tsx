import { useState, type ReactNode } from 'react';
import { Xmark } from 'iconoir-react';
import { KINDS, type ActionFormProps, type ActionMap, type Kind } from './kinds';
import { NumberField, SelectField, StringListField, TextField, LinesField } from './fields';

/** The same actions as the technical editor, described from the caller's point of view. */
export const OUTCOMES: Record<Kind, { title: string; hint: string }> = {
  route: { title: 'Send requests to another app', hint: 'Choose which app receives the traffic.' },
  rewrite: {
    title: 'Change a request’s path',
    hint: 'Send a different path to your app without changing the visitor’s URL.',
  },
  redirect: {
    title: 'Send visitors to another URL',
    hint: 'Point visitors to a new page or website.',
  },
  headers: {
    title: 'Change request or response headers',
    hint: 'Add or remove information sent with a request or response.',
  },
  cors: {
    title: 'Allow calls from another website',
    hint: 'Let a web frontend call your app from a browser.',
  },
  jwt: {
    title: 'Require a signed token',
    hint: 'Check who issued the token before letting a request through.',
  },
  ip: {
    title: 'Allow or block IP addresses',
    hint: 'Control access from specific addresses or networks.',
  },
  validate: {
    title: 'Check incoming JSON data',
    hint: 'Require request bodies to follow a defined shape.',
  },
  limit: { title: 'Limit upload size', hint: 'Reject request bodies that are too large.' },
  maintenance: {
    title: 'Pause traffic for maintenance',
    hint: 'Tell callers the app is temporarily unavailable.',
  },
  geo: {
    title: 'Allow or block countries',
    hint: 'Control access based on where a request comes from.',
  },
  throttle: {
    title: 'Limit how often clients can call',
    hint: 'Set a request rate and allow short bursts.',
  },
  budget: { title: 'Set a response deadline', hint: 'Stop waiting when a request takes too long.' },
  cache: {
    title: 'Reuse recent responses',
    hint: 'Serve eligible repeat requests without running the app again.',
  },
  challenge: {
    title: 'Check that callers use a browser',
    hint: 'Ask browsers to complete a check; verified callers can pass.',
  },
  waf: {
    title: 'Detect suspicious requests',
    hint: 'Record, warn about, or block signs of common attacks.',
  },
  retry: {
    title: 'Retry connection failures',
    hint: 'Try another healthy instance when the connection fails.',
  },
  circuit_breaker: {
    title: 'Avoid failing instances',
    hint: 'Temporarily stop sending requests to an unhealthy instance.',
  },
  async: {
    title: 'Run requests in the background',
    hint: 'Accept the request now and let the caller check its progress.',
  },
  respond: {
    title: 'Return a fixed response',
    hint: 'Give a preview app a response before its endpoint is ready.',
  },
};

export const OUTCOME_GROUPS: { title: string; kinds: Kind[] }[] = [
  {
    title: 'Send and change requests',
    kinds: ['route', 'redirect', 'rewrite', 'headers', 'respond'],
  },
  {
    title: 'Control who gets through',
    kinds: ['geo', 'ip', 'cors', 'jwt', 'challenge', 'waf', 'validate'],
  },
  {
    title: 'Manage traffic and reliability',
    kinds: [
      'throttle',
      'cache',
      'maintenance',
      'limit',
      'budget',
      'retry',
      'circuit_breaker',
      'async',
    ],
  },
];

// ISO country codes are the API values; people choose their English names.
const COUNTRY_CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(
    ' '
  );
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => (code === 'TR' ? 'Turkey' : (countryNames.of(code) ?? code));
const countryOptions = COUNTRY_CODES.map((code) => ({
  value: code,
  label: countryName(code),
})).sort((a, b) => a.label.localeCompare(b.label));

function CountryChoice({ value, onChange, errors }: ActionFormProps<ActionMap['geo']>) {
  const [mode, setMode] = useState<'deny' | 'allow'>(value.allow?.length ? 'allow' : 'deny');
  const selected = value[mode] ?? [];
  return (
    <div className="flex flex-col gap-4">
      <SelectField
        label="What should happen?"
        value={mode}
        onChange={(next) => {
          setMode(next);
          onChange({ ...value, [next]: selected, [next === 'deny' ? 'allow' : 'deny']: [] });
        }}
        options={[
          { value: 'deny', label: 'Block requests from these countries' },
          { value: 'allow', label: 'Allow requests only from these countries' },
        ]}
      />
      <SelectField
        label="Add a country"
        value=""
        error={errors.allow ?? errors.deny}
        onChange={(code) => {
          if (code && !selected.includes(code)) onChange({ ...value, [mode]: [...selected, code] });
        }}
        options={[
          { value: '', label: 'Choose a country…' },
          ...countryOptions.filter((c) => !selected.includes(c.value)),
        ]}
      />
      {!!selected.length && (
        <ul className="flex flex-wrap gap-2" aria-label="Selected countries">
          {selected.map((code) => (
            <li
              key={code}
              className="flex items-center gap-1 surface rounded-[1.25rem] bg-card py-1 pl-3 pr-1 text-sm"
            >
              {countryName(code)}
              <button
                type="button"
                aria-label={`Remove ${countryName(code)}`}
                className="rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() =>
                  onChange({ ...value, [mode]: selected.filter((item) => item !== code) })
                }
              >
                <Xmark className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {!!value.allow?.length && !!value.deny?.length && (
        <p className="text-xs text-muted-foreground">
          This rule also has country exceptions. Review them in Advanced settings.
        </p>
      )}
    </div>
  );
}

/** One draft, two presentations: these controls never own or replace the full action. */
export const SIMPLE_FORMS = {
  route: ({ value, onChange, errors, apps }) => (
    <SelectField
      label="Send requests to"
      error={errors.target_app_slug}
      value={value.target_app_slug}
      onChange={(target_app_slug) => onChange({ ...value, target_app_slug })}
      options={[
        { value: '', label: 'Choose an app…' },
        ...apps.map((app) => ({ value: app.slug, label: app.slug })),
      ]}
    />
  ),
  rewrite: KINDS.rewrite.Form,
  redirect: ({ value, onChange, errors }) => (
    <div className="flex flex-col gap-4">
      <TextField
        label="Send visitors to"
        hint="A full website address or a path such as /new-page."
        value={value.to}
        error={errors.to}
        onChange={(to) => onChange({ ...value, to })}
        placeholder="https://example.com/new"
      />
      <SelectField
        label="Is this move permanent?"
        value={String(value.status_code)}
        onChange={(code) =>
          onChange({ ...value, status_code: Number(code) as ActionMap['redirect']['status_code'] })
        }
        options={[
          { value: '308', label: 'Yes, use this address from now on' },
          { value: '307', label: 'No, this is temporary' },
          ...([301, 302].includes(value.status_code)
            ? [
                {
                  value: String(value.status_code),
                  label: `Keep the existing ${value.status_code} redirect`,
                },
              ]
            : []),
        ]}
      />
    </div>
  ),
  headers: () => (
    <p className="text-sm leading-relaxed text-muted-foreground">
      Choose which information to add or remove from requests and responses in Advanced settings.
    </p>
  ),
  cors: ({ value, onChange, errors }) =>
    value.cors_preset_id ? (
      <p className="text-sm text-muted-foreground">
        Uses a saved browser-access policy. Review or change that policy in Advanced settings.
      </p>
    ) : (
      <StringListField
        label="Websites that can call this app"
        hint="Enter a full website address, then press Enter. Calls use GET by default; other methods are in Advanced settings."
        value={value.allow_origins}
        error={errors.allow_origins}
        onChange={(allow_origins) => onChange({ ...value, allow_origins })}
        placeholder="https://app.example.com"
      />
    ),
  jwt: ({ value, onChange, errors }) => (
    <div className="flex flex-col gap-4">
      <TextField
        label="Who issues the token?"
        hint="The issuer address from your authentication provider."
        value={value.issuer}
        error={errors.issuer}
        onChange={(issuer) => onChange({ ...value, issuer })}
        placeholder="https://auth.example.com/"
      />
      <TextField
        label="Where are the public signing keys?"
        hint="Your provider’s JWKS address. Advanced settings has algorithms and required claims."
        value={value.jwks_url}
        error={errors.jwks_url}
        onChange={(jwks_url) => onChange({ ...value, jwks_url })}
        placeholder="https://auth.example.com/.well-known/jwks.json"
      />
    </div>
  ),
  ip: ({ value, onChange, errors }) => (
    <div className="flex flex-col gap-4">
      <LinesField
        label="Block these addresses"
        hint="One IP address or network range per line."
        value={value.deny ?? []}
        error={errors.deny}
        onChange={(deny) => onChange({ ...value, deny })}
        placeholder="203.0.113.4"
      />
      <LinesField
        label="Allow only these addresses"
        hint="Optional. If you list any, all other addresses are blocked. The block list takes precedence."
        value={value.allow ?? []}
        error={errors.allow}
        onChange={(allow) => onChange({ ...value, allow })}
      />
    </div>
  ),
  validate: ({ value }) => (
    <p className="text-sm leading-relaxed text-muted-foreground">
      {value.schema?.type === 'object' && Object.keys(value.schema).length === 1
        ? 'Requests must contain a JSON object.'
        : 'Requests are checked against your custom JSON schema.'}{' '}
      Define required fields and other checks in Advanced settings.
    </p>
  ),
  limit: ({ value, onChange, errors }) => (
    <NumberField
      label="Largest request body (MiB)"
      hint="1 MiB is 1,048,576 bytes. Set a separate streaming limit in Advanced settings."
      value={value.max_body_bytes / 1048576}
      error={errors.max_body_bytes}
      onChange={(v) => onChange({ ...value, max_body_bytes: Math.round((v ?? 0) * 1048576) })}
    />
  ),
  maintenance: ({ value, onChange }) => (
    <TextField
      label="What should callers see?"
      hint="Optional. Callers receive a temporary-unavailable response and can retry after 5 minutes by default."
      mono={false}
      value={value.message ?? ''}
      onChange={(message) => onChange({ ...value, message })}
      placeholder="We’re making an update. Please try again shortly."
    />
  ),
  geo: CountryChoice,
  throttle: ({ value, onChange, errors, suggest }) => (
    <div className="flex flex-col gap-4">
      <NumberField
        label="Requests allowed per second"
        value={value.requests_per_second}
        error={errors.requests_per_second}
        min={1}
        onChange={(v) => onChange({ ...value, requests_per_second: v ?? 0 })}
      />
      <NumberField
        label="Requests allowed in a short burst"
        hint="Must be at least the per-second limit."
        value={value.burst}
        error={errors.burst}
        min={1}
        onChange={(v) => onChange({ ...value, burst: v ?? 0 })}
      />
      {suggest}
    </div>
  ),
  budget: ({ value, onChange, errors }) => (
    <NumberField
      label="Stop waiting after (seconds)"
      hint="Includes time spent starting a sleeping app."
      value={value.budget_ms / 1000}
      error={errors.budget_ms}
      onChange={(v) => onChange({ ...value, budget_ms: Math.round((v ?? 0) * 1000) })}
    />
  ),
  cache: ({ value, onChange, errors }) => (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Reuse a response for (seconds)"
        hint="Up to 3,600 seconds. Zero uses the server default of 60 seconds."
        value={value.max_age_seconds}
        error={errors.max_age_seconds}
        emptyWhenNegative
        onChange={(v) => onChange({ ...value, max_age_seconds: v ?? -1 })}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        Only eligible GET and HEAD responses are reused. Requests with cookies or authorization
        bypass the cache. By default, a cached response may also be served for up to 5 minutes if
        the app fails; adjust this in Advanced settings.
      </p>
    </div>
  ),
  challenge: ({ value, onChange, errors }) => (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Remember a successful check for (minutes)"
        hint="From 5 minutes to 1 day."
        value={(value.pass_ttl_seconds ?? 3600) / 60}
        error={errors.pass_ttl_seconds}
        min={5}
        onChange={(v) => onChange({ ...value, pass_ttl_seconds: Math.round((v ?? 0) * 60) })}
      />
      <p className="text-xs text-muted-foreground">
        Verified crawlers and callers with a verified API key or token can pass. Scripts without one
        receive a refusal.
      </p>
    </div>
  ),
  waf: ({ value, onChange, wafBlocking }) => (
    <div className="flex flex-col gap-3">
      <SelectField
        label="When a suspicious request is found"
        value={value.mode ?? 'observe'}
        onChange={(mode) =>
          onChange({ ...value, mode, ...(mode !== 'observe' ? { paranoia_level: 1 } : {}) })
        }
        options={[
          { value: 'observe', label: 'Record it and let it through' },
          ...(wafBlocking
            ? [
                { value: 'warn' as const, label: 'Let it through with a warning' },
                { value: 'block' as const, label: 'Block it' },
              ]
            : []),
        ]}
      />
      <p className="text-xs text-muted-foreground">
        {wafBlocking
          ? 'Blocking checks request headers and URLs. Request bodies are observed only.'
          : 'Blocking and warnings are not available for this account; requests are recorded only.'}
      </p>
    </div>
  ),
  retry: ({ value, onChange, errors }) => (
    <SelectField
      label="How many tries in total?"
      hint="Includes the first try. Responses from the app, including errors, are never replayed."
      value={String(value.max_attempts ?? 2)}
      error={errors.max_attempts}
      onChange={(v) => onChange({ ...value, max_attempts: Number(v) })}
      options={[
        { value: '2', label: '2 tries — retry once' },
        { value: '3', label: '3 tries — retry twice' },
      ]}
    />
  ),
  circuit_breaker: ({ value, onChange, errors }) => (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Stop using an instance when this share of requests fails (%)"
        value={(value.failure_threshold ?? 0.5) * 100}
        error={errors.failure_threshold}
        min={1}
        onChange={(v) => onChange({ ...value, failure_threshold: (v ?? 0) / 100 })}
      />
      <p className="text-xs text-muted-foreground">
        This changes the app’s existing failure protection. The highest-priority rule sets the
        policy for every instance, regardless of its request path.
      </p>
    </div>
  ),
  async: () => (
    <p className="text-sm leading-relaxed text-muted-foreground">
      Callers get an acceptance response and a status URL. The app processes the request later using
      its current retry and deadline defaults. Add completion notifications or custom retries in
      Advanced settings.
    </p>
  ),
  respond: () => (
    <p className="text-sm leading-relaxed text-muted-foreground">
      Set the response status and JSON body in Advanced settings. The preview below describes the
      current response.
    </p>
  ),
} satisfies { [K in Kind]: (props: ActionFormProps<ActionMap[K]>) => ReactNode };

/** Errors for essential inputs stay in the simple view; other fields open the full editor. */
export const SIMPLE_FIELDS: Partial<Record<Kind, string[]>> = {
  route: ['target_app_slug'],
  rewrite: ['from', 'to'],
  redirect: ['to', 'status_code'],
  cors: ['allow_origins'],
  jwt: ['issuer', 'jwks_url'],
  ip: ['allow', 'deny'],
  geo: ['allow', 'deny'],
  limit: ['max_body_bytes'],
  throttle: ['requests_per_second', 'burst'],
  budget: ['budget_ms'],
  cache: ['max_age_seconds'],
  challenge: ['pass_ttl_seconds'],
  waf: ['mode'],
  retry: ['max_attempts'],
  circuit_breaker: ['failure_threshold'],
};
