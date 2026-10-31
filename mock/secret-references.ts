import type { components } from '../src/lib/api/schema';
import * as db from './data';
import { environmentInventory } from './environments';
import { projects } from './projects';

type S = components['schemas'];
type Fail = { status: number; code: string; detail: string };
export type Result<T> = { ok: T } | { fail: Fail };

const KEY = /^[A-Z][A-Z0-9_]*$/;
const ENVIRONMENT = /^[a-z0-9](?:[a-z0-9-]{0,31}[a-z0-9])?$/;
const no = (status: number, code: string, detail: string): { fail: Fail } => ({
  fail: { status, code, detail },
});

/**
 * Secret references (faas ADR-568, handlers_secret_references.go): per project
 * environment, a destination variable delivered from a sealed secret of the
 * same app in that exact scope. Removing one leaves a suppression behind, so
 * the main workload stops receiving the key even by name.
 *
 * Sources live here rather than in `db.secrets`, which only holds `default`.
 * Keyed by app id and environment slug.
 */
const SOURCES: Record<string, Record<string, string[]>> = {
  'api-gateway': {
    production: ['DATABASE_PRIMARY', 'STRIPE_LIVE_KEY'],
    staging: ['DATABASE_PRIMARY'],
  },
  'image-resize': { staging: ['CACHE_PRIMARY'] },
  'webhook-router': { production: ['API_KEY'] },
};
/** Plain variables set in an environment scope, which a reference may not shadow. */
const PLAIN: Record<string, Record<string, string[]>> = {
  'api-gateway': { production: ['REGION'] },
};
/** webhook-router's production references are owned by Git (enforce mode). */
const GIT_OWNED = new Set(['webhook-router/production']);

const at = (a: db.App, environment: string) => `${a.id}|${environment}`;
const sources = new Map<string, string[]>();
const intent = new Map<string, { refs: Record<string, string>; suppressed: Set<string> }>();
for (const a of db.apps) {
  for (const [environment, keys] of Object.entries(SOURCES[a.slug] ?? {}))
    sources.set(at(a, environment), [...keys]);
  if (a.slug === 'api-gateway')
    intent.set(at(a, 'production'), {
      refs: { DATABASE_URL: 'secret:DATABASE_PRIMARY' },
      suppressed: new Set(['LEGACY_TOKEN']),
    });
}

function environmentOf(a: db.App, environment: string): Result<S['ProjectEnvironmentResponse']> {
  if (environment === 'default' || environment === 'pr-preview' || !ENVIRONMENT.test(environment))
    return no(400, 'validation_failed', 'environment must name a registered project environment');
  const project = projects.find((p) => p.workloads.some((w) => w.slug === a.slug));
  const found = project && environmentInventory(project.slug)?.find((e) => e.slug === environment);
  if (!found)
    return no(
      404,
      'not_found',
      'The application or its registered project environment was not found.'
    );
  return { ok: found };
}

const intentOf = (a: db.App, environment: string) => {
  const key = at(a, environment);
  if (!intent.has(key)) intent.set(key, { refs: {}, suppressed: new Set() });
  return intent.get(key)!;
};

function used(a: db.App) {
  let refs = 0;
  for (const [key, value] of intent)
    if (key.startsWith(`${a.id}|`)) refs += Object.keys(value.refs).length;
  return (db.env.get(a.slug) ?? []).length + refs;
}

/** The env quota the mock's `/env` route reports. */
const QUOTA = 128;

export function readReferences(
  a: db.App,
  environment: string
): Result<S['AppSecretReferenceListResponse']> {
  const env = environmentOf(a, environment);
  if (!('ok' in env)) return env;
  const current = intentOf(a, environment);
  return {
    ok: {
      environment_id: env.ok.id,
      environment,
      references: { ...current.refs },
      ...(current.suppressed.size ? { suppressed_keys: [...current.suppressed].sort() } : {}),
      count: used(a),
      quota: QUOTA,
    },
  };
}

/** The app's sealed secrets in one scope, as `GET /secrets?scope=` lists them. */
export function scopedSecrets(a: db.App, scope: string): S['AppSecretResponse'][] {
  return (sources.get(at(a, scope)) ?? []).map((key) => ({
    key,
    scope,
    secret_class: 'persistent',
    delivery_version: 1,
    delivered_version: 1,
    delivery_status: 'delivered',
    created_at: db.iso(9 * 24 * 3600000),
    updated_at: db.iso(2 * 24 * 3600000),
  }));
}

function guardWrite(
  a: db.App,
  environment: string,
  key: string
): Result<S['ProjectEnvironmentResponse']> {
  if (!KEY.test(key) || key.length > 128)
    return no(
      400,
      'env_var_invalid_key',
      'must start with a letter and contain only A-Z, 0-9, underscore'
    );
  const env = environmentOf(a, environment);
  if (!('ok' in env)) return env;
  if (GIT_OWNED.has(`${a.slug}/${environment}`))
    return no(
      409,
      'environment_field_git_managed',
      'Change the environment definition in Git, or create a temporary override with a reason and expiry before editing this setting.'
    );
  return env;
}

export function writeReference(
  a: db.App,
  environment: string,
  key: string,
  reference: unknown
): Result<S['AppSecretReferenceResponse']> {
  if (
    typeof reference !== 'string' ||
    !reference.startsWith('secret:') ||
    !KEY.test(reference.slice(7))
  )
    return no(400, 'validation_failed', 'reference must name a scoped secret as secret:NAME');
  const env = guardWrite(a, environment, key);
  if (!('ok' in env)) return env;
  if (!(sources.get(at(a, environment)) ?? []).includes(reference.slice(7)))
    return no(
      400,
      'secret_not_found',
      'Create the named secret in this environment before referencing it.'
    );
  const plain = [
    ...(PLAIN[a.slug]?.[environment] ?? []),
    ...(db.env.get(a.slug) ?? []).filter((row) => row.scope === environment).map((row) => row.key),
  ];
  if (plain.includes(key))
    return no(
      409,
      'secret_reference_conflict',
      'Reload the environment and remove any plaintext variable with this destination key before trying again.'
    );
  const current = intentOf(a, environment);
  if (!(key in current.refs) && used(a) >= QUOTA)
    return no(
      403,
      'plan_limit_env_vars',
      `plan allows ${QUOTA} env var(s) per app; you have ${used(a) + 1}.`
    );
  current.refs[key] = reference;
  current.suppressed.delete(key);
  return { ok: { environment_id: env.ok.id, environment, key, reference } };
}

export function removeReference(a: db.App, environment: string, key: string): Result<null> {
  const env = guardWrite(a, environment, key);
  if (!('ok' in env)) return env;
  const current = intentOf(a, environment);
  delete current.refs[key];
  current.suppressed.add(key);
  return { ok: null };
}

// --- Revocations ---------------------------------------------------------------

type Target = S['SecretRevocationTarget'];
/** Who was running when a secret was deleted, and how each one answers. */
type Plan = {
  target: Omit<Target, 'status'>;
  settlesAfterMs?: number;
  outcome?: 'applied' | 'failed';
  revision: string;
};
const ROSTER: Record<
  string,
  Array<Omit<Plan, 'target' | 'revision'> & { workload?: string; reload: Target['reload_support'] }>
> = {
  // Main and a proxy sidecar, both opted in to live reload.
  'api-gateway': [
    { reload: 'enabled', settlesAfterMs: 6_000, outcome: 'applied' },
    { workload: 'proxy', reload: 'enabled', settlesAfterMs: 12_000, outcome: 'applied' },
  ],
  // No reload label: keeps the value in memory until replaced.
  'image-resize': [{ reload: 'disabled' }],
  // Opted in, but the app's own reload handler reports failure.
  'webhook-router': [{ reload: 'enabled', settlesAfterMs: 8_000, outcome: 'failed' }],
  // Opted in, but stopped before it acknowledged: no ack can arrive any more
  // (faas queries.sql:924), so it stays pending and the console stops waiting.
  'search-indexer': [{ reload: 'enabled' }],
};

const uuid = () => db.id().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
const newRevision = () => (db.id() + db.id()).slice(0, 64);
const revocations = new Map<
  string,
  { appId: string; createdMs: number; base: S['AppSecretRevocationResponse']; plans: Plan[] }
>();

function project(
  entry: { createdMs: number; base: S['AppSecretRevocationResponse']; plans: Plan[] },
  now: number
): S['AppSecretRevocationResponse'] {
  const targets = entry.plans.map(({ target, settlesAfterMs, outcome, revision }): Target => {
    if (!outcome || settlesAfterMs === undefined || now - entry.createdMs < settlesAfterMs)
      return { ...target, status: 'pending' };
    return {
      ...target,
      status: outcome,
      ack_revision: revision,
      ack_at: new Date(entry.createdMs + settlesAfterMs).toISOString(),
      ...(outcome === 'failed' ? { error_code: 'application_reload_failed' as const } : {}),
    };
  });
  // Mirrors state.AppSecretRevocation.Progress (pkg/state/types.go).
  const pending = targets.filter((t) => t.status !== 'applied');
  const status = !pending.length
    ? 'complete'
    : pending.some((t) => t.reload_support !== 'enabled')
      ? 'blocked'
      : pending.some((t) => t.status === 'failed')
        ? 'failed'
        : 'pending';
  return {
    ...entry.base,
    status,
    target_count: targets.length,
    acknowledged_count: targets.length - pending.length,
    pending_count: pending.length,
    targets,
  };
}

/** The receipt `DELETE /secrets/{key}` returns with `Prefer: return=representation`. */
export function recordRevocation(a: db.App, scope: string, key: string, now = Date.now()) {
  const id = uuid();
  const plans: Plan[] = (ROSTER[a.slug] ?? []).map(({ workload, reload, ...rest }) => ({
    ...rest,
    revision: newRevision(),
    target: {
      instance_id: uuid(),
      ...(workload ? { workload_name: workload } : {}),
      runtime_state: 'running',
      reload_support: reload,
    },
  }));
  const entry = {
    appId: a.id,
    createdMs: now,
    plans,
    base: {
      id,
      scope,
      key,
      created_at: new Date(now).toISOString(),
      status: 'pending' as const,
      target_count: 0,
      acknowledged_count: 0,
      pending_count: 0,
      targets: [],
    },
  };
  revocations.set(id, entry);
  return project(entry, now);
}

export function readRevocation(a: db.App, id: string, now = Date.now()) {
  const entry = revocations.get(id);
  if (!entry || entry.appId !== a.id) return undefined;
  return project(entry, now);
}
