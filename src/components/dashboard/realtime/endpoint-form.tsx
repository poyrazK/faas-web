import { useId, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Select, Textarea } from '@/components/ui/field';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
  REALTIME_ALGORITHMS,
  createRealtimeEndpoint,
  realtimeKeys,
  updateRealtimeEndpoint,
  type CreateRealtimeEndpoint,
  type RealtimeAlgorithm,
  type RealtimeAuthMode,
  type RealtimeEndpoint,
  type UpdateRealtimeEndpoint,
} from '@/lib/api/realtime';
import { explainToast } from './realtime-shared';

/**
 * Create or edit a managed realtime endpoint.
 *
 * Tokens are write-only: apid seals them and answers with a constant mask
 * (faas pkg/apid/managedrealtime/handlers.go:104), so an edit leaves a token
 * alone unless one is typed. A PATCH sends only what changed — omitted fields
 * stay (UpdateManagedRealtimeEndpointRequest). Changing how the endpoint
 * admits clients closes the open connections the new settings would refuse
 * (docs/realtime.md § Authentication), so those edits, and disabling, ask
 * first.
 */

const AUTH_LABEL: Record<RealtimeAuthMode, string> = {
  none: 'None — anyone with the URL',
  static_bearer: 'Static bearer token',
  oidc_jwt: 'OIDC JSON Web Token',
};
export const AUTH_SHORT: Record<RealtimeAuthMode, string> = {
  none: 'No client auth',
  static_bearer: 'Static bearer',
  oidc_jwt: 'OIDC JWT',
};

const DEFAULT_PATHS = {
  connect: '/realtime/connect',
  message: '/realtime/message',
  disconnect: '/realtime/disconnect',
};

const lines = (text: string) =>
  text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

function parseClaims(text: string): { claims: Record<string, string>; error?: string } {
  const claims: Record<string, string> = {};
  for (const line of text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)) {
    const at = line.indexOf('=');
    if (at <= 0) return { claims, error: 'Write one KEY=VALUE per line.' };
    claims[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  if (Object.keys(claims).length > 16) return { claims, error: 'At most 16 claims.' };
  return { claims };
}

function isHttpUrl(value: string, httpsOnly = false) {
  try {
    const u = new URL(value);
    return httpsOnly ? u.protocol === 'https:' : u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function pathError(value: string) {
  if (!value) return undefined;
  if (!value.startsWith('/') || value.includes('..') || /[?#]/.test(value) || value.length > 256)
    return 'Start with “/”, with no “..”, “?” or “#”, in 256 characters or fewer.';
  return undefined;
}

function originError(origins: string[]) {
  if (origins.length > 16) return 'At most 16 origins.';
  for (const o of origins) {
    try {
      const u = new URL(o);
      if (!/^https?:$/.test(u.protocol) || (u.pathname !== '/' && u.pathname !== '') || u.search)
        return `“${o}” is not an origin: use scheme and host only, like https://app.example.com.`;
    } catch {
      return `“${o}” is not an origin: use scheme and host only, like https://app.example.com.`;
    }
  }
  return undefined;
}

function intError(value: string, max: number) {
  if (value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= max ? undefined : `A whole number from 0 to ${max}.`;
}

/** 32 random bytes as hex, generated in the browser and never stored. */
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const sameList = (a: readonly string[] | undefined, b: readonly string[]) =>
  (a ?? []).length === b.length && (a ?? []).every((x, i) => x === b[i]);
const sameClaims = (a: Record<string, string> | undefined, b: Record<string, string>) => {
  const ka = Object.keys(a ?? {});
  return ka.length === Object.keys(b).length && ka.every((k) => a?.[k] === b[k]);
};

export interface GeneratedSecret {
  title: string;
  value: string;
}

export function EndpointForm({
  slug,
  appUrl,
  endpoint,
  onDone,
  onCancel,
}: {
  slug: string;
  appUrl?: string;
  /** Absent to create. */
  endpoint?: RealtimeEndpoint;
  /** Saved; `generated` holds any token the console generated, to show once. */
  onDone: (saved: RealtimeEndpoint, generated: GeneratedSecret[]) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const editing = Boolean(endpoint);
  const [callbackUrl, setCallbackUrl] = useState(endpoint?.callback_url ?? appUrl ?? '');
  const [connectPath, setConnectPath] = useState(endpoint?.connect_path ?? '');
  const [messagePath, setMessagePath] = useState(endpoint?.message_path ?? '');
  const [disconnectPath, setDisconnectPath] = useState(endpoint?.disconnect_path ?? '');
  const [callbackToken, setCallbackToken] = useState('');
  const [callbackGenerated, setCallbackGenerated] = useState(false);
  const [authMode, setAuthMode] = useState<RealtimeAuthMode>(endpoint?.auth_mode ?? 'none');
  const [authToken, setAuthToken] = useState('');
  const [authGenerated, setAuthGenerated] = useState(false);
  const [issuer, setIssuer] = useState(endpoint?.auth_issuer ?? '');
  const [jwksUrl, setJwksUrl] = useState(endpoint?.auth_jwks_url ?? '');
  const [audience, setAudience] = useState((endpoint?.auth_audience ?? []).join(', '));
  const [algorithms, setAlgorithms] = useState<RealtimeAlgorithm[]>(
    endpoint?.auth_algorithms?.length ? endpoint.auth_algorithms : ['RS256']
  );
  const [claimsText, setClaimsText] = useState(
    Object.entries(endpoint?.auth_required_claims ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')
  );
  const [originsText, setOriginsText] = useState((endpoint?.allowed_origins ?? []).join('\n'));
  const [maxConnections, setMaxConnections] = useState(String(endpoint?.max_connections ?? 0));
  const [maxMessageBytes, setMaxMessageBytes] = useState(String(endpoint?.max_message_bytes ?? 0));
  const [maxAge, setMaxAge] = useState(String(endpoint?.max_connection_age_seconds ?? 0));
  const [enabled, setEnabled] = useState(endpoint?.enabled ?? true);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const origins = lines(originsText);
  const audiences = lines(audience);
  const { claims, error: claimsError } = parseClaims(claimsText);
  // A static bearer endpoint needs a token on create, and when switching to it.
  const needsAuthToken =
    authMode === 'static_bearer' && (!editing || endpoint?.auth_mode !== 'static_bearer');
  const errors: Record<string, string | undefined> = {
    callback_url: !callbackUrl
      ? 'Where Gregale sends connect, message and disconnect callbacks.'
      : !isHttpUrl(callbackUrl)
        ? 'An absolute http:// or https:// URL.'
        : undefined,
    connect_path: pathError(connectPath),
    message_path: pathError(messagePath),
    disconnect_path: pathError(disconnectPath),
    callback_auth_token:
      !editing && !callbackToken
        ? 'Your app checks this token on every callback.'
        : callbackToken.length > 256
          ? 'Use 256 characters or fewer.'
          : undefined,
    auth_token:
      needsAuthToken && !authToken
        ? 'Clients send this token to connect.'
        : authToken.length > 256
          ? 'Use 256 characters or fewer.'
          : undefined,
    auth_issuer:
      authMode === 'oidc_jwt' && !isHttpUrl(issuer, true)
        ? 'The issuer, an https:// URL.'
        : undefined,
    auth_jwks_url:
      authMode === 'oidc_jwt' && !isHttpUrl(jwksUrl, true)
        ? 'Where your provider publishes its keys, an https:// URL.'
        : undefined,
    auth_algorithms:
      authMode === 'oidc_jwt' && algorithms.length === 0 ? 'Choose at least one.' : undefined,
    auth_required_claims: authMode === 'oidc_jwt' ? claimsError : undefined,
    allowed_origins: originError(origins),
    max_connections: intError(maxConnections, 10000),
    max_message_bytes: intError(maxMessageBytes, 1048576),
    max_connection_age_seconds: intError(maxAge, 604800),
  };
  const shown = (name: string) => (attempted ? errors[name] : undefined);

  const oidc =
    authMode === 'oidc_jwt'
      ? {
          auth_issuer: issuer,
          auth_jwks_url: jwksUrl,
          auth_audience: audiences,
          auth_algorithms: algorithms,
          auth_required_claims: claims,
        }
      : {};

  function createBody(): CreateRealtimeEndpoint {
    return {
      callback_url: callbackUrl,
      ...(connectPath ? { connect_path: connectPath } : {}),
      ...(messagePath ? { message_path: messagePath } : {}),
      ...(disconnectPath ? { disconnect_path: disconnectPath } : {}),
      callback_auth_token: callbackToken,
      auth_mode: authMode,
      ...(authMode === 'static_bearer' ? { auth_token: authToken } : {}),
      ...oidc,
      allowed_origins: origins,
      max_connections: Number(maxConnections || 0),
      max_message_bytes: Number(maxMessageBytes || 0),
      max_connection_age_seconds: Number(maxAge || 0),
      enabled,
    };
  }

  function updateBody(e: RealtimeEndpoint): UpdateRealtimeEndpoint {
    const body: UpdateRealtimeEndpoint = {};
    if (callbackUrl !== e.callback_url) body.callback_url = callbackUrl;
    if (connectPath && connectPath !== e.connect_path) body.connect_path = connectPath;
    if (messagePath && messagePath !== e.message_path) body.message_path = messagePath;
    if (disconnectPath && disconnectPath !== e.disconnect_path)
      body.disconnect_path = disconnectPath;
    if (callbackToken) body.callback_auth_token = callbackToken;
    if (authMode !== e.auth_mode) body.auth_mode = authMode;
    if (authMode === 'static_bearer' && authToken) body.auth_token = authToken;
    if (authMode === 'oidc_jwt') {
      if (issuer !== (e.auth_issuer ?? '')) body.auth_issuer = issuer;
      if (jwksUrl !== (e.auth_jwks_url ?? '')) body.auth_jwks_url = jwksUrl;
      if (!sameList(e.auth_audience, audiences)) body.auth_audience = audiences;
      if (!sameList(e.auth_algorithms, algorithms)) body.auth_algorithms = algorithms;
      if (!sameClaims(e.auth_required_claims, claims)) body.auth_required_claims = claims;
    }
    if (!sameList(e.allowed_origins, origins)) body.allowed_origins = origins;
    if (Number(maxConnections || 0) !== e.max_connections)
      body.max_connections = Number(maxConnections || 0);
    if (Number(maxMessageBytes || 0) !== e.max_message_bytes)
      body.max_message_bytes = Number(maxMessageBytes || 0);
    if (Number(maxAge || 0) !== e.max_connection_age_seconds)
      body.max_connection_age_seconds = Number(maxAge || 0);
    if (enabled !== e.enabled) body.enabled = enabled;
    return body;
  }

  /** What an edit does to open connections, or nothing when it leaves them alone. */
  function disruption(e: RealtimeEndpoint, body: UpdateRealtimeEndpoint) {
    if (body.enabled === false)
      return 'Disabling refuses new handshakes and closes every open connection on this endpoint.';
    const removedOrigin = (e.allowed_origins ?? []).some((o) => !origins.includes(o));
    const admission =
      body.auth_mode !== undefined ||
      body.auth_token !== undefined ||
      body.auth_issuer !== undefined ||
      body.auth_jwks_url !== undefined ||
      body.auth_audience !== undefined ||
      body.auth_algorithms !== undefined ||
      body.auth_required_claims !== undefined ||
      (body.allowed_origins !== undefined && removedOrigin);
    return admission
      ? 'This changes how the endpoint admits clients. Gregale closes every open connection the new settings would refuse (close code 1008), and those clients must reconnect with valid credentials.'
      : undefined;
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (Object.values(errors).some(Boolean) || saving) return;
    const generated: GeneratedSecret[] = [];
    if (callbackToken && callbackGenerated)
      generated.push({ title: 'Callback token', value: callbackToken });
    if (authMode === 'static_bearer' && authToken && authGenerated)
      generated.push({ title: 'Client bearer token', value: authToken });
    let saved: RealtimeEndpoint;
    setSaving(true);
    try {
      if (endpoint) {
        const body = updateBody(endpoint);
        if (Object.keys(body).length === 0) {
          onCancel();
          return;
        }
        const effect = disruption(endpoint, body);
        if (
          effect &&
          !(await confirm({
            title: 'Save and close refused connections?',
            description: effect,
            confirmLabel: 'Save changes',
            destructive: true,
          }))
        )
          return;
        saved = await updateRealtimeEndpoint(slug, endpoint.id, body);
      } else {
        saved = await createRealtimeEndpoint(slug, createBody());
      }
    } catch (err) {
      toast({
        kind: 'error',
        title: editing ? 'Could not save the endpoint' : 'Could not create the endpoint',
        ...explainToast(err),
      });
      return;
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ queryKey: realtimeKeys.endpoints(slug) });
    }
    // The form owns no plaintext once the API has it.
    setCallbackToken('');
    setAuthToken('');
    toast({ kind: 'success', title: editing ? 'Endpoint saved' : 'Endpoint created' });
    onDone(saved, generated);
  };

  const field = (name: string) => `${id}-${name}`;

  return (
    <form
      noValidate
      onSubmit={(e) => void submit(e)}
      aria-label={editing ? 'Edit endpoint' : 'New endpoint'}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id={field('callback')}
          label="Callback URL"
          hint="Your app's base URL; the callback paths below are joined to it."
          error={shown('callback_url')}
          showError
        >
          {(p) => (
            <Input
              {...p}
              name="callback_url"
              value={callbackUrl}
              onChange={(e) => setCallbackUrl(e.target.value.trim())}
              placeholder="https://my-app.example.com"
            />
          )}
        </FormField>
        <SecretField
          id={field('callback-token')}
          name="callback_auth_token"
          label={editing ? 'Replace callback token' : 'Callback token'}
          hint={
            editing
              ? 'Leave empty to keep the current token. Accept both tokens in your app until queued callbacks drain.'
              : 'Sent as a bearer token on every callback; check it in your app. Write-only.'
          }
          value={callbackToken}
          error={shown('callback_auth_token')}
          onChange={(value, generated) => {
            setCallbackToken(value);
            setCallbackGenerated(generated);
          }}
        />
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Callback paths</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {(
            [
              ['connect', 'Connect path', connectPath, setConnectPath, 'connect_path'],
              ['message', 'Message path', messagePath, setMessagePath, 'message_path'],
              [
                'disconnect',
                'Disconnect path',
                disconnectPath,
                setDisconnectPath,
                'disconnect_path',
              ],
            ] as const
          ).map(([key, label, value, set, name]) => (
            <FormField key={key} id={field(key)} label={label} error={shown(name)} showError>
              {(p) => (
                <Input
                  {...p}
                  name={name}
                  value={value}
                  onChange={(e) => set(e.target.value.trim())}
                  placeholder={DEFAULT_PATHS[key]}
                  className="font-mono"
                />
              )}
            </FormField>
          ))}
        </div>
      </details>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id={field('auth-mode')}
          label="Client authentication"
          hint={
            authMode === 'none'
              ? 'Use only for public data.'
              : authMode === 'static_bearer'
                ? 'Suits a few trusted backend clients.'
                : "The token's sub becomes the connection's principal. Use it for browsers."
          }
        >
          {(p) => (
            <Select
              {...p}
              name="auth_mode"
              value={authMode}
              onChange={(e) => setAuthMode(e.target.value as RealtimeAuthMode)}
              className="w-full"
            >
              {(Object.keys(AUTH_LABEL) as RealtimeAuthMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {AUTH_LABEL[mode]}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        {authMode === 'static_bearer' && (
          <SecretField
            id={field('auth-token')}
            name="auth_token"
            label={needsAuthToken ? 'Client bearer token' : 'Replace client token now'}
            hint={
              needsAuthToken
                ? 'Clients send Authorization: Bearer with this token. Write-only.'
                : 'Replacing here cuts the old token off at once. Rotate with an overlap below instead.'
            }
            value={authToken}
            error={shown('auth_token')}
            onChange={(value, generated) => {
              setAuthToken(value);
              setAuthGenerated(generated);
            }}
          />
        )}
      </div>

      {authMode === 'oidc_jwt' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id={field('issuer')} label="Issuer" error={shown('auth_issuer')} showError>
            {(p) => (
              <Input
                {...p}
                name="auth_issuer"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value.trim())}
                placeholder="https://id.example.com"
              />
            )}
          </FormField>
          <FormField id={field('jwks')} label="JWKS URL" error={shown('auth_jwks_url')} showError>
            {(p) => (
              <Input
                {...p}
                name="auth_jwks_url"
                value={jwksUrl}
                onChange={(e) => setJwksUrl(e.target.value.trim())}
                placeholder="https://id.example.com/.well-known/jwks.json"
              />
            )}
          </FormField>
          <FormField id={field('audience')} label="Audience" hint="Comma-separated; optional.">
            {(p) => (
              <Input
                {...p}
                name="auth_audience"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="realtime"
              />
            )}
          </FormField>
          <fieldset className="flex min-w-0 flex-col gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">Algorithms</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {REALTIME_ALGORITHMS.map((alg) => (
                <label key={alg} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    name="auth_algorithms"
                    checked={algorithms.includes(alg)}
                    onChange={(e) =>
                      setAlgorithms((current) =>
                        e.target.checked ? [...current, alg] : current.filter((a) => a !== alg)
                      )
                    }
                    className="h-3.5 w-3.5 accent-[color:var(--brand)]"
                  />
                  {alg}
                </label>
              ))}
            </div>
            {shown('auth_algorithms') && (
              <p role="alert" className="text-[13px] text-destructive">
                {shown('auth_algorithms')}
              </p>
            )}
          </fieldset>
          <FormField
            id={field('claims')}
            label="Required claims"
            hint="One KEY=VALUE per line; optional."
            error={shown('auth_required_claims')}
            showError
          >
            {(p) => (
              <Textarea
                {...p}
                name="auth_required_claims"
                value={claimsText}
                onChange={(e) => setClaimsText(e.target.value)}
                className="font-mono text-xs"
                rows={2}
              />
            )}
          </FormField>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          id={field('origins')}
          label="Allowed origins"
          hint="One per line. Browsers that send their token as a subprotocol connect only from these."
          error={shown('allowed_origins')}
          showError
        >
          {(p) => (
            <Textarea
              {...p}
              name="allowed_origins"
              value={originsText}
              onChange={(e) => setOriginsText(e.target.value)}
              placeholder="https://app.example.com"
              className="font-mono text-xs"
              rows={2}
            />
          )}
        </FormField>
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-3">
          {(
            [
              ['max-conn', 'Max connections', maxConnections, setMaxConnections, 'max_connections'],
              [
                'max-bytes',
                'Max message bytes',
                maxMessageBytes,
                setMaxMessageBytes,
                'max_message_bytes',
              ],
              ['max-age', 'Max age (s)', maxAge, setMaxAge, 'max_connection_age_seconds'],
            ] as const
          ).map(([key, label, value, set, name]) => (
            <FormField key={key} id={field(key)} label={label} error={shown(name)} showError>
              {(p) => (
                <Input
                  {...p}
                  name={name}
                  inputMode="numeric"
                  value={value}
                  onChange={(e) => set(e.target.value.trim())}
                  className="tabular-nums"
                />
              )}
            </FormField>
          ))}
          <p className="text-[13px] leading-5 text-muted-foreground min-[420px]:col-span-3">
            0 uses the realtime node&apos;s default. Your plan&apos;s account-wide connection limit
            applies on top.
          </p>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-3.5 w-3.5 accent-[color:var(--brand)]"
        />
        Enabled — accepts new connections
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" busy={saving}>
          {editing ? 'Save endpoint' : 'Create endpoint'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** A write-only token: masked, never pre-filled, with an in-browser generator. */
export function SecretField({
  id,
  name,
  label,
  hint,
  value,
  error,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  hint: string;
  value: string;
  error?: string;
  onChange: (value: string, generated: boolean) => void;
}) {
  return (
    <FormField id={id} label={label} hint={hint} error={error} showError>
      {(p) => (
        <div className="flex gap-2">
          <Input
            {...p}
            name={name}
            type="password"
            autoComplete="new-password"
            value={value}
            onChange={(e) => onChange(e.target.value, false)}
            className="font-mono"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 shrink-0"
            onClick={() => onChange(randomToken(), true)}
          >
            Generate
          </Button>
        </div>
      )}
    </FormField>
  );
}
