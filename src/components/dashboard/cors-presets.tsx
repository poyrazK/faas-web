import { useState } from 'react';
import { EditPencil, Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, Select } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { PlanGated } from '@/components/dashboard/plan-gated';
import { Pill } from '@/components/dashboard/resource-table';
import { slugIndex } from '@/lib/api/adapters';
import { corsPresetUsers, useUpdateCorsPreset } from '@/lib/api/edge-protection';
import { ApiError } from '@/lib/api/errors';
import {
  useApp,
  useApps,
  useCorsPresets,
  useCreateCorsPreset,
  useDeleteCorsPreset,
  useEdgeRules,
  type CorsPreset,
  type EdgeRule,
} from '@/lib/api/queries';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useAuth } from '@/lib/auth';
import { useCapability } from '@/lib/api/capabilities';
import { MaturityLabel } from '@/components/dashboard/maturity-label';
import { cn } from '@/lib/utils';

/**
 * CORS presets (ADR-129): a named allow-list the account keeps once and
 * references from any CORS edge rule by `cors_preset_id`, instead of
 * retyping origins per rule.
 *
 * Two surfaces. The panel under the edge-rules table lists, creates, edits
 * and deletes the presets — account-wide ones and the ones scoped to the app
 * in view. The picker sits at the top of the CORS rule form: choosing a
 * preset fills the rule's fields from it and records the id, so the gateway
 * compiles the rule against the preset and a later edit to the preset
 * reaches the rule.
 *
 * Presets belong to the signed-in account (faas handlers_cors_presets.go
 * reads and writes them by `acct.ID`; there is no organization variant), so a
 * company workspace shows neither the list nor the picker rather than the
 * personal account's presets.
 *
 * An edit or delete changes the served policy of every rule using the
 * preset, account-wide (pkg/apid/edgerules/referenced_edit.go:179), and a
 * delete clears those rules' reference (ON DELETE SET NULL) so they fail
 * closed. The API does not list the users, so they are read from
 * `/v1/edge-rules` and named before either.
 *
 * The API's refusals are matched on code: the Free-tier gate
 * (`402 plan_cors_presets_not_allowed`), the quota
 * (`403 plan_cors_preset_quota_reached`) and a list over the plan's cap
 * (`422 cors_preset_too_large`). Everything else — a duplicate name (409),
 * a bad origin, a wildcard with credentials — is `validation_failed`, whose
 * sentence says what to change.
 */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function explain(
  err: unknown,
  fallback = 'Could not save the preset'
): { kind: 'info' | 'error'; title: string; error?: unknown } {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'plan_cors_presets_not_allowed':
        return { kind: 'info', title: 'Not on your plan', error: err };
      case 'plan_cors_preset_quota_reached':
        return { kind: 'info', title: 'Preset limit reached', error: err };
      case 'cors_preset_too_large':
        return { kind: 'error', title: 'Too many entries for your plan', error: err };
    }
  }
  return { kind: 'error', title: fallback, error: err };
}

/** "api · api.acme.dev/*" for each rule, in the order the API lists them. */
function ruleLabels(rules: EdgeRule[], slugs: Map<string, string>) {
  return rules.map(
    (r) => `${slugs.get(r.app_id) ?? r.app_id} · ${r.match_host || '*'}${r.match_path || '/*'}`
  );
}

export function CorsPresetsPanel({ slug }: { slug?: string }) {
  const workspace = useWorkspaceTarget();
  if (!workspace.ready)
    return (
      <Panel title="CORS presets">
        <LoadingState message="Loading CORS presets…" />
      </Panel>
    );
  if (workspace.org)
    return (
      <Panel title="CORS presets">
        <p className="text-sm text-muted-foreground">
          {workspace.label} has no CORS presets of its own: a preset belongs to a personal account.
          Switch to your personal workspace to manage yours.
        </p>
      </Panel>
    );
  return <AccountPresets slug={slug} />;
}

function AccountPresets({ slug }: { slug?: string }) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const app = useApp(slug ?? '');
  const appId = slug ? app.data?.id : undefined;
  const presets = useCorsPresets();
  const { capability } = useCapability('cors-presets');
  // Every rule on the account, since an edit reaches all of them.
  const rules = useEdgeRules(true, accountId);
  const { data: apps } = useApps(undefined, accountId);
  const slugs = slugIndex(apps ?? []);
  const phase = queryPhase({ error: presets.error, loading: presets.isPending });
  const visible = (presets.data?.presets ?? []).filter(
    (p) => !p.app_id || !appId || p.app_id === appId
  );
  // null while the rules load or when they fail: a count that could not be
  // established is never reported as "no rules".
  const usersOf = (id: string) =>
    rules.data ? ruleLabels(corsPresetUsers(rules.data, id), slugs) : null;

  return (
    <PlanGated error={presets.error} feature="CORS presets">
      <Panel
        title="CORS presets"
        description="Named allow-lists a CORS edge rule can reference, so origins are kept once and edited once."
        actions={<MaturityLabel capability={capability} />}
      >
        {phase === 'unreachable' ? (
          <UnreachableState onRetry={() => void presets.refetch()} />
        ) : phase === 'loading' ? (
          <LoadingState message="Loading CORS presets…" />
        ) : phase === 'error' ? (
          <ErrorState error={presets.error} onRetry={() => void presets.refetch()} />
        ) : (
          <div className="flex flex-col gap-5">
            {visible.length === 0 ? (
              <EmptyState message="No presets yet. Create one below, then pick it in a CORS rule." />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {visible.map((p) => (
                  <PresetRow key={p.id} preset={p} users={usersOf(p.id)} />
                ))}
              </ul>
            )}
            <PresetForm appId={appId} />
          </div>
        )}
      </Panel>
    </PlanGated>
  );
}

function PresetRow({ preset, users }: { preset: CorsPreset; users: string[] | null }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const remove = useDeleteCorsPreset();
  const [editing, setEditing] = useState(false);

  const onDelete = async () => {
    const consequence =
      users === null
        ? "Couldn't check which edge rules use it. Any that do lose the link and fail closed until they get a new preset or inline values."
        : users.length === 0
          ? 'No edge rule uses it.'
          : `${users.length === 1 ? 'This rule loses the link and fails' : `These ${users.length} rules lose the link and fail`} closed until given a new preset or inline values: ${users.join('; ')}.`;
    if (
      !(await confirm({
        title: `Delete preset "${preset.name}"?`,
        description: consequence,
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(preset.id);
      toast({ kind: 'success', title: 'Preset deleted' });
    } catch (err) {
      toast(explain(err, 'Could not delete the preset'));
    }
  };

  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-sm font-medium">{preset.name}</span>
        <Pill label={preset.app_id ? 'this app' : 'account'} />
        <span className="break-all font-mono text-muted-foreground">
          {preset.allow_origins.join(', ')}
        </span>
        <span className="font-mono text-muted-foreground">{preset.allow_methods.join('/')}</span>
        {preset.allow_credentials && <Pill label="credentials" color="var(--status-warning)" />}
        <span className="text-muted-foreground">max-age {preset.max_age_seconds}s</span>
        {users !== null && users.length > 0 && (
          <span className="text-muted-foreground">
            Used by {users.length} rule{users.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="ml-auto flex gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-label={`Edit preset ${preset.name}`}
          >
            <EditPencil className="h-3.5 w-3.5" />
            Edit
          </Button>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void onDelete()}
            disabled={remove.isPending}
            aria-label={`Delete preset ${preset.name}`}
          >
            <Trash className="h-3.5 w-3.5" />
            Delete
          </Button>
        </span>
      </div>
      {editing && (
        <div className="rounded-md border border-border p-4">
          <PresetForm preset={preset} users={users} onDone={() => setEditing(false)} />
        </div>
      )}
    </li>
  );
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

/**
 * The create form, or with `preset` the edit form. An edit sends only the
 * fields that changed (apid's PATCH leaves the rest as they are) and keeps the
 * scope: apid decodes `"app_id": null` as "leave it", so moving a scoped
 * preset to the whole account cannot be expressed
 * (handlers_cors_presets.go:408-414).
 */
function PresetForm({
  appId,
  preset,
  users = null,
  onDone,
}: {
  appId?: string;
  preset?: CorsPreset;
  users?: string[] | null;
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const create = useCreateCorsPreset();
  const update = useUpdateCorsPreset();
  const [name, setName] = useState(preset?.name ?? '');
  const [origins, setOrigins] = useState(preset?.allow_origins.join(' ') ?? '');
  const [methods, setMethods] = useState<string[]>(preset?.allow_methods ?? ['GET']);
  const [description, setDescription] = useState(preset?.description ?? '');
  const [headers, setHeaders] = useState(preset?.allow_headers?.join(', ') ?? '');
  const [exposed, setExposed] = useState(preset?.expose_headers?.join(', ') ?? '');
  const [credentials, setCredentials] = useState(preset?.allow_credentials ?? false);
  const [maxAge, setMaxAge] = useState(String(preset?.max_age_seconds ?? 600));
  const [scope, setScope] = useState<'account' | 'app'>(
    preset ? (preset.app_id ? 'app' : 'account') : appId ? 'app' : 'account'
  );
  const pending = preset ? update.isPending : create.isPending;

  const originList = splitList(origins);
  const headerList = splitList(headers);
  const exposedList = splitList(exposed);
  const wildcardWithCredentials = credentials && originList.includes('*');
  const maxAgeValue = Number(maxAge);
  const valid =
    name.trim().length > 0 &&
    name.trim().length <= 64 &&
    originList.length > 0 &&
    methods.length > 0 &&
    maxAge.trim() !== '' &&
    Number.isInteger(maxAgeValue) &&
    maxAgeValue >= 0 &&
    maxAgeValue <= 86400 &&
    !wildcardWithCredentials;

  const changes = preset
    ? {
        ...(name.trim() !== preset.name ? { name: name.trim() } : {}),
        ...(description.trim() !== (preset.description ?? '')
          ? { description: description.trim() }
          : {}),
        ...(sameList(originList, preset.allow_origins) ? {} : { allow_origins: originList }),
        ...(sameList(methods, preset.allow_methods) ? {} : { allow_methods: methods }),
        ...(sameList(headerList, preset.allow_headers ?? []) ? {} : { allow_headers: headerList }),
        ...(sameList(exposedList, preset.expose_headers ?? [])
          ? {}
          : { expose_headers: exposedList }),
        ...(credentials !== preset.allow_credentials ? { allow_credentials: credentials } : {}),
        ...(maxAgeValue !== preset.max_age_seconds ? { max_age_seconds: maxAgeValue } : {}),
      }
    : null;
  const ready = valid && (changes === null || Object.keys(changes).length > 0);

  // An edit changes the live CORS policy of every rule using the preset,
  // account-wide, so it is confirmed whenever any might.
  const reach =
    users === null
      ? "Couldn't check which edge rules use this preset; saving changes the CORS policy of any that do."
      : users.length === 0
        ? 'No edge rule uses this preset yet.'
        : `Saving changes the CORS policy of ${users.length === 1 ? 'this rule' : `these ${users.length} rules`}: ${users.join('; ')}.`;

  const submit = async () => {
    if (
      preset &&
      (users === null || users.length > 0) &&
      !(await confirm({
        title: `Save preset "${preset.name}"?`,
        description: `${reach} Browsers see the new policy as soon as the gateways apply it.`,
        confirmLabel: 'Save',
      }))
    )
      return;
    try {
      if (preset && changes) {
        const saved = await update.mutateAsync({ id: preset.id, body: changes });
        toast({ kind: 'success', title: `Preset "${saved.name}" saved` });
        onDone?.();
        return;
      }
      const created = await create.mutateAsync({
        name: name.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        app_id: scope === 'app' && appId ? appId : null,
        allow_origins: originList,
        allow_methods: methods,
        allow_headers: headerList,
        expose_headers: exposedList,
        allow_credentials: credentials,
        max_age_seconds: maxAgeValue,
      });
      setName('');
      setDescription('');
      setOrigins('');
      setHeaders('');
      setExposed('');
      toast({ kind: 'success', title: `Preset "${created.name}" created` });
    } catch (err) {
      toast(explain(err));
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      aria-label={preset ? `Edit preset ${preset.name}` : 'New preset'}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !pending) void submit();
      }}
    >
      <p className="label-mono text-muted-foreground">{preset ? 'Edit preset' : 'New preset'}</p>
      {preset && <p className="text-xs text-muted-foreground">{reach}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="web-clients"
            maxLength={64}
            className={cn(FIELD, 'w-full')}
            aria-label="Preset name"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Scope</span>
          <Select
            value={scope}
            onChange={(e) => setScope(e.target.value as 'account' | 'app')}
            aria-label="Preset scope"
            disabled={Boolean(preset) || !appId}
          >
            <option value="account">Whole account</option>
            {(appId || preset?.app_id) && <option value="app">This app only</option>}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs text-muted-foreground">Description (optional)</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="The marketing site and the console"
            className={cn(FIELD, 'w-full')}
            aria-label="Preset description"
          />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs text-muted-foreground">
            Allowed origins (comma or space separated; * for any)
          </span>
          <input
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder="https://app.example.com https://admin.example.com"
            className={cn(FIELD, 'w-full font-mono')}
            aria-label="Allowed origins"
          />
        </label>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs text-muted-foreground">Allowed methods</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Allowed methods">
            {METHODS.map((m) => {
              const on = methods.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setMethods(on ? methods.filter((x) => x !== m) : [...methods, m])}
                  className={cn(
                    'rounded-md border px-2 py-1 font-mono text-xs transition-colors',
                    on
                      ? 'border-brand/50 bg-brand/10 text-foreground'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Allowed headers (optional)</span>
          <input
            value={headers}
            onChange={(e) => setHeaders(e.target.value)}
            placeholder="Authorization, X-Request-Id"
            className={cn(FIELD, 'w-full font-mono')}
            aria-label="Allowed headers"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Exposed headers (optional)</span>
          <input
            value={exposed}
            onChange={(e) => setExposed(e.target.value)}
            placeholder="X-Request-Id, ETag"
            className={cn(FIELD, 'w-full font-mono')}
            aria-label="Exposed headers"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Max age (seconds, 0–86400)</span>
          <input
            type="number"
            min={0}
            max={86400}
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value)}
            className={cn(FIELD, 'w-full')}
            aria-label="Max age seconds"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
          <Switch
            checked={credentials}
            onCheckedChange={setCredentials}
            aria-label="Allow credentials"
            className="data-[state=checked]:bg-brand"
          />
          Allow credentials
          {wildcardWithCredentials && (
            <span style={{ color: 'var(--status-critical)' }}>
              — browsers refuse credentials for a wildcard origin; name the origins.
            </span>
          )}
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="gap-1.5" disabled={!ready} busy={pending}>
          {preset ? (
            'Save preset'
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              Create preset
            </>
          )}
        </Button>
        {preset && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** The select at the top of a CORS rule form; picking fills the rule from the preset. */
export function CorsPresetPicker({
  slug,
  value,
  onPick,
}: {
  /** The app the rule belongs to; another app's scoped preset is not offered. */
  slug?: string;
  value: string | null;
  onPick: (preset: CorsPreset | null) => void;
}) {
  // A company workspace has no presets, and the personal account's are not
  // offered there (see CorsPresetsPanel).
  const workspace = useWorkspaceTarget();
  if (!workspace.ready || workspace.org) return null;
  return <AccountPresetPicker slug={slug} value={value} onPick={onPick} />;
}

function AccountPresetPicker({
  slug,
  value,
  onPick,
}: {
  slug?: string;
  value: string | null;
  onPick: (preset: CorsPreset | null) => void;
}) {
  const presets = useCorsPresets();
  const app = useApp(slug ?? '');
  const appId = slug ? app.data?.id : undefined;
  // An app-scoped preset is visible only to its own app: referencing another
  // app's preset compiles the rule away at the gateway and the route 404s,
  // with nothing said anywhere.
  const list = (presets.data?.presets ?? []).filter((p) => !p.app_id || p.app_id === appId);
  if (presets.isPending || presets.error || list.length === 0) return null;
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label-mono text-muted-foreground">Preset</span>
      <Select
        value={value ?? ''}
        onChange={(e) => onPick(list.find((p) => p.id === e.target.value) ?? null)}
        aria-label="CORS preset"
      >
        <option value="">None — inline values below</option>
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
            {p.app_id ? ' (this app)' : ' (account)'}
          </option>
        ))}
      </Select>
      <span className="text-xs text-muted-foreground">
        A preset keeps the origins in one place; the fields below are filled from it and the rule
        follows later edits to the preset.
      </span>
    </label>
  );
}
