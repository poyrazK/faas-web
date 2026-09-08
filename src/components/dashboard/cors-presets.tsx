import { useState } from 'react';
import { Plus, Trash } from 'iconoir-react';
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
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useApp,
  useCorsPresets,
  useCreateCorsPreset,
  useDeleteCorsPreset,
  type CorsPreset,
} from '@/lib/api/queries';
import { cn } from '@/lib/utils';

/**
 * CORS presets (ADR-129): a named allow-list the account keeps once and
 * references from any CORS edge rule by `cors_preset_id`, instead of
 * retyping origins per rule.
 *
 * Two surfaces. The panel under the edge-rules table lists and manages the
 * presets — account-wide ones and the ones scoped to the app in view. The
 * picker sits at the top of the CORS rule form: choosing a preset fills the
 * rule's fields from it and records the id, so the gateway compiles the
 * rule against the preset and a later edit to the preset reaches the rule.
 *
 * The API's refusals are specific and each reads as itself: the Free-tier
 * cap (`402 plan_cors_preset_not_allowed`, the plan panel), a quota
 * (`403 plan_cors_preset_quota_reached`), a duplicate name
 * (`409 cors_preset_name_conflict`), and the wildcard-with-credentials
 * footgun (`422 cors_wildcard_with_credentials`), which is also refused
 * client-side before it is sent.
 */

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

function splitList(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function explain(err: unknown): { kind: 'info' | 'error'; title: string; description?: string } {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'plan_cors_preset_not_allowed':
        return { kind: 'info', title: 'Not on your plan', description: errorMessage(err) };
      case 'plan_cors_preset_quota_reached':
        return { kind: 'info', title: 'Preset limit reached', description: errorMessage(err) };
      case 'cors_preset_name_conflict':
        return {
          kind: 'error',
          title: 'A preset with that name exists',
          description: 'Names are unique per scope.',
        };
      case 'cors_wildcard_with_credentials':
        return {
          kind: 'error',
          title: 'Wildcard origin with credentials',
          description: 'Browsers refuse credentials for `*`; name the origins instead.',
        };
      case 'cors_preset_invalid':
        return { kind: 'error', title: 'Preset rejected', description: errorMessage(err) };
      case 'not_found':
        return {
          kind: 'info',
          title: 'Already gone',
          description: 'The preset was deleted elsewhere.',
        };
    }
  }
  return { kind: 'error', title: 'Could not save the preset', description: errorMessage(err) };
}

export function CorsPresetsPanel({ slug }: { slug?: string }) {
  const app = useApp(slug ?? '');
  const appId = slug ? app.data?.id : undefined;
  const presets = useCorsPresets();
  const phase = queryPhase({ error: presets.error, loading: presets.isPending });
  const visible = (presets.data?.presets ?? []).filter(
    (p) => !p.app_id || !appId || p.app_id === appId
  );

  return (
    <PlanGated error={presets.error} feature="CORS presets">
      <Panel
        title="CORS presets"
        description="Named allow-lists a CORS edge rule can reference, so origins are kept once and edited once."
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
                  <PresetRow key={p.id} preset={p} />
                ))}
              </ul>
            )}
            <CreatePreset appId={appId} />
          </div>
        )}
      </Panel>
    </PlanGated>
  );
}

function PresetRow({ preset }: { preset: CorsPreset }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const remove = useDeleteCorsPreset();

  const onDelete = async () => {
    if (
      !(await confirm({
        title: `Delete preset "${preset.name}"?`,
        description:
          'Edge rules that reference it lose the link and fail closed until they get a new preset or inline values.',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(preset.id);
      toast({ kind: 'success', title: 'Preset deleted' });
    } catch (err) {
      toast(explain(err));
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-3 py-3 text-xs first:pt-0 last:pb-0">
      <span className="text-sm font-medium">{preset.name}</span>
      <Pill label={preset.app_id ? 'this app' : 'account'} color="var(--status-idle)" />
      <span className="font-mono text-muted-foreground">{preset.allow_origins.join(', ')}</span>
      <span className="font-mono text-muted-foreground">{preset.allow_methods.join('/')}</span>
      {preset.allow_credentials && <Pill label="credentials" color="var(--status-warning)" />}
      <span className="text-muted-foreground">max-age {preset.max_age_seconds}s</span>
      <Button
        size="xs"
        variant="ghost"
        className="ml-auto"
        onClick={() => void onDelete()}
        disabled={remove.isPending}
        aria-label={`Delete preset ${preset.name}`}
      >
        <Trash className="h-3.5 w-3.5" />
        Delete
      </Button>
    </li>
  );
}

function CreatePreset({ appId }: { appId?: string }) {
  const { toast } = useToast();
  const create = useCreateCorsPreset();
  const [name, setName] = useState('');
  const [origins, setOrigins] = useState('');
  const [methods, setMethods] = useState<string[]>(['GET']);
  const [headers, setHeaders] = useState('');
  const [credentials, setCredentials] = useState(false);
  const [maxAge, setMaxAge] = useState('600');
  const [scope, setScope] = useState<'account' | 'app'>(appId ? 'app' : 'account');

  const originList = splitList(origins);
  const wildcardWithCredentials = credentials && originList.includes('*');
  const maxAgeValue = Number(maxAge);
  const ready =
    name.trim().length > 0 &&
    name.trim().length <= 64 &&
    originList.length > 0 &&
    methods.length > 0 &&
    Number.isInteger(maxAgeValue) &&
    maxAgeValue >= 0 &&
    maxAgeValue <= 86400 &&
    !wildcardWithCredentials;

  const submit = async () => {
    try {
      const preset = await create.mutateAsync({
        name: name.trim(),
        app_id: scope === 'app' && appId ? appId : null,
        allow_origins: originList,
        allow_methods: methods,
        allow_headers: splitList(headers),
        allow_credentials: credentials,
        max_age_seconds: maxAgeValue,
      });
      setName('');
      setOrigins('');
      setHeaders('');
      toast({ kind: 'success', title: `Preset "${preset.name}" created` });
    } catch (err) {
      toast(explain(err));
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !create.isPending) void submit();
      }}
    >
      <p className="label-mono text-muted-foreground">New preset</p>
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
            disabled={!appId}
          >
            <option value="account">Whole account</option>
            {appId && <option value="app">This app only</option>}
          </Select>
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
      <div>
        <Button
          type="submit"
          size="sm"
          className="gap-1.5"
          disabled={!ready}
          busy={create.isPending}
        >
          <Plus className="h-3.5 w-3.5" />
          Create preset
        </Button>
      </div>
    </form>
  );
}

/** The select at the top of a CORS rule form; picking fills the rule from the preset. */
export function CorsPresetPicker({
  value,
  onPick,
}: {
  value: string | null;
  onPick: (preset: CorsPreset | null) => void;
}) {
  const presets = useCorsPresets();
  const list = presets.data?.presets ?? [];
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
            {p.app_id ? ' (this app)' : ''}
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
