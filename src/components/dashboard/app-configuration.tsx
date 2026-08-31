import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { FIELD as BASE_FIELD } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import {
  useApp,
  useAppDiff,
  useDeleteApp,
  useRenameApp,
  useUpdateApp,
  type App,
} from '@/lib/api/queries';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { Modal } from '@/components/ui/modal';
import { ErrorState, LoadingState, Panel, UnreachableState, queryPhase } from './primitives';
import { RegistryCredentialsPanel } from './app-core-panels';
import { SupplyChainPanel } from './supply-chain-panel';

/**
 * The app's own settings, editable.
 *
 * This tab was a read-only definition list: memory, runtime, endpoint, last
 * deployed — visible and untouchable, while the API takes a PATCH with
 * sixteen fields and nothing in the console ever sent one. Scale-to-zero,
 * the thing the Settings page now points here for, is `idle_timeout_s` and
 * `min_instances` on this form.
 *
 * Reads the real `AppResponse` rather than the store's `Workflow` adapter,
 * which flattens exactly the fields this page needs to edit.
 */

const MEMORY = [128, 256, 512, 1024, 2048] as const;

type Draft = {
  ram_mb: number;
  idle_timeout_s: number;
  max_concurrency: number;
  min_instances: number;
  autoscale_target_rps: number;
  streaming_enabled: boolean;
  websocket_enabled: boolean;
  route_metrics_enabled: boolean;
  maintenance_mode: boolean;
  egress_allowlist: string;
  require_authn: boolean;
  cors_default_enabled: boolean;
  cors_default_origins: string;
  eviction_priority: 'best_effort' | 'reserved';
  app_protocol: 'http1' | 'http2' | 'grpc';
  overflow_node: string;
  autoscale_target_cpu_pct: number;
  warm_snapshot_enabled: boolean;
  warm_snapshot_min_ms: number;
  warm_snapshot_min_requests: number;
  public_auth_mode: 'open' | 'bearer' | 'basic';
  public_auth_user: string;
  public_auth_pass: string;
};

export function draftFrom(app: App): Draft {
  return {
    ram_mb: app.ram_mb,
    idle_timeout_s: app.idle_timeout_s ?? 60,
    max_concurrency: app.max_concurrency,
    min_instances: app.min_instances,
    autoscale_target_rps: app.autoscale_target_rps,
    streaming_enabled: app.streaming_enabled ?? false,
    websocket_enabled: app.websocket_enabled ?? false,
    route_metrics_enabled: app.route_metrics_enabled ?? false,
    maintenance_mode: app.maintenance_mode ?? false,
    egress_allowlist: (app.egress_allowlist ?? []).join('\n'),
    require_authn: app.require_authn ?? false,
    cors_default_enabled: app.cors_default_enabled ?? false,
    cors_default_origins: (app.cors_default_origins ?? []).join('\n'),
    eviction_priority: (app.eviction_priority ?? 'best_effort') as 'best_effort' | 'reserved',
    // ADR-124: the closed set {http1, http2, grpc}; http1 is the universal default.
    app_protocol: (app.app_protocol ?? 'http1') as 'http1' | 'http2' | 'grpc',
    overflow_node: app.overflow_node ?? '',
    autoscale_target_cpu_pct: app.autoscale_target_cpu_pct ?? 0,
    warm_snapshot_enabled: app.warm_snapshot_enabled ?? false,
    warm_snapshot_min_ms: app.warm_snapshot_min_ms ?? 1000,
    warm_snapshot_min_requests: app.warm_snapshot_min_requests ?? 1,
    // Write-only: the mode reads back, credentials never do.
    public_auth_mode: (app.public_auth?.mode ?? 'open') as 'open' | 'bearer' | 'basic',
    public_auth_user: '',
    public_auth_pass: '',
  };
}

const FIELD = `${BASE_FIELD} w-full [font-variant-numeric:tabular-nums]`;

function NumberField({
  label,
  hint,
  value,
  min,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label-mono text-muted-foreground">{label}</span>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || 0))}
        className={FIELD}
      />
      <span className="text-xs text-muted-foreground">{hint}</span>
    </label>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <li className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={label}
        className="mt-1 data-[state=checked]:bg-brand"
      />
    </li>
  );
}

function ConfigForm({ app }: { app: App }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const update = useUpdateApp(app.slug);
  const diff = useAppDiff(app.slug);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof diff.mutateAsync>> | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(app));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Only what changed goes over the wire: a PATCH that restates every field
  // also restates every field the person did not mean to touch.
  const changes = useMemo(() => {
    const base = draftFrom(app);
    const out: Record<string, unknown> = {};
    const listKeys = new Set(['egress_allowlist', 'cors_default_origins']);
    const authKeys = new Set(['public_auth_mode', 'public_auth_user', 'public_auth_pass']);
    for (const key of Object.keys(draft) as (keyof Draft)[]) {
      if (authKeys.has(key)) continue;
      if (draft[key] !== base[key]) {
        out[key] = listKeys.has(key)
          ? String(draft[key])
              .split('\n')
              .map((l) => l.trim())
              .filter(Boolean)
          : draft[key];
      }
    }
    // public_auth is one atomic block: emitted when the mode changes, or
    // when basic credentials are (re)entered. Credentials never read back.
    const authDirty =
      draft.public_auth_mode !== base.public_auth_mode ||
      (draft.public_auth_mode === 'basic' &&
        Boolean(draft.public_auth_user || draft.public_auth_pass));
    if (authDirty) {
      out.public_auth =
        draft.public_auth_mode === 'basic'
          ? {
              mode: 'basic',
              basic_user: draft.public_auth_user,
              basic_pass: draft.public_auth_pass,
            }
          : { mode: draft.public_auth_mode };
    }
    return out;
  }, [app, draft]);
  const dirty = Object.keys(changes).length > 0;

  // Navigating away with unsaved edits asks first — in the same dialog every
  // other destructive act uses — instead of silently discarding them.
  useUnsavedGuard(dirty, () =>
    confirm({
      title: 'Discard unsaved changes?',
      description: 'The runtime settings you edited have not been saved.',
      confirmLabel: 'Discard changes',
      destructive: true,
    })
  );

  const save = () => {
    void update
      .mutateAsync(changes)
      .then((next) => {
        setDraft(draftFrom(next));
        toast({
          kind: 'success',
          title: 'Settings saved',
          description: `${app.slug} will use them on its next wake.`,
        });
      })
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not save', description: errorMessage(err) })
      );
  };

  return (
    <>
      <Panel
        lit
        title="Runtime"
        description="Applied on the next wake. A running instance keeps what it booted with."
        actions={
          <>
            {/* The CLI's deploy --diff, one click before Save: the server
                says exactly what this PATCH would change, and what it would
                break, before anything is written. */}
            <Button
              size="sm"
              variant="outline"
              disabled={!dirty}
              busy={diff.isPending}
              onClick={() =>
                void diff
                  .mutateAsync(changes)
                  .then(setPreview)
                  .catch((err: unknown) =>
                    toast({
                      kind: 'error',
                      title: 'Could not preview',
                      description: errorMessage(err),
                    })
                  )
              }
            >
              Preview
            </Button>
            <Button size="sm" disabled={!dirty} busy={update.isPending} onClick={save}>
              Save changes
            </Button>
          </>
        }
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Memory</span>
            <div className="flex flex-wrap gap-1.5">
              {MEMORY.map((mb) => (
                <button
                  key={mb}
                  type="button"
                  aria-pressed={draft.ram_mb === mb}
                  onClick={() => set('ram_mb', mb)}
                  className={`h-9 rounded-md border px-3 font-mono text-xs pressable ${
                    draft.ram_mb === mb
                      ? 'border-brand bg-brand/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {mb} MB
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              Per instance. Billed as GB-seconds while resident.
            </span>
          </label>

          <NumberField
            label="Idle timeout (s)"
            hint="Seconds without a request before the instance snapshots and parks. This is scale-to-zero."
            value={draft.idle_timeout_s}
            min={5}
            onChange={(n) => set('idle_timeout_s', n)}
          />
          <NumberField
            label="Minimum instances"
            hint="Kept resident even when idle, and billed the whole time. 0 means park when quiet."
            value={draft.min_instances}
            min={0}
            onChange={(n) => set('min_instances', n)}
          />
          <NumberField
            label="Max concurrency"
            hint="Instances this app may run at once. Each one costs memory."
            value={draft.max_concurrency}
            min={1}
            onChange={(n) => set('max_concurrency', n)}
          />
          <NumberField
            label="Autoscale target (rps)"
            hint="Requests per second per instance before another one is added."
            value={draft.autoscale_target_rps}
            min={1}
            onChange={(n) => set('autoscale_target_rps', n)}
          />
          <NumberField
            label="Autoscale target (CPU %)"
            hint="Scale up when an instance sustains this CPU. 0 disables. Pro and Scale."
            value={draft.autoscale_target_cpu_pct}
            min={0}
            onChange={(n) => set('autoscale_target_cpu_pct', Math.min(100, n))}
          />

          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Eviction tier</span>
            <div className="flex gap-1.5">
              {(['best_effort', 'reserved'] as const).map((tier) => (
                <button
                  key={tier}
                  type="button"
                  aria-pressed={draft.eviction_priority === tier}
                  onClick={() => set('eviction_priority', tier)}
                  className={`pressable h-9 rounded-md border px-3 font-mono text-xs ${
                    draft.eviction_priority === tier
                      ? 'border-brand bg-brand/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tier === 'best_effort' ? 'best effort' : 'reserved'}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              Reserved apps are parked last under cross-account RAM pressure. Paid plans, capped per
              account.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Wire protocol</span>
            <div className="flex gap-1.5">
              {(['http1', 'http2', 'grpc'] as const).map((proto) => (
                <button
                  key={proto}
                  type="button"
                  aria-pressed={draft.app_protocol === proto}
                  onClick={() => set('app_protocol', proto)}
                  className={`pressable h-9 rounded-md border px-3 font-mono text-xs ${
                    draft.app_protocol === proto
                      ? 'border-brand bg-brand/10 text-foreground'
                      : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {proto}
                </button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              What the edge speaks to the app. gRPC needs Hobby or above.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Overflow node</span>
            <input
              value={draft.overflow_node}
              onChange={(e) => set('overflow_node', e.target.value)}
              placeholder="fra-metal-2"
              spellCheck={false}
              className={FIELD}
            />
            <span className="text-xs text-muted-foreground">
              Preferred spill target under node pressure. Empty leaves placement to the scheduler.
            </span>
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className="label-mono text-muted-foreground">Egress allowlist</span>
            <textarea
              value={draft.egress_allowlist}
              onChange={(e) => set('egress_allowlist', e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={'10.0.0.0/8\n203.0.113.4/32'}
              className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-brand/50"
            />
            <span className="text-xs text-muted-foreground">
              One CIDR per line. Empty means the platform denylist alone applies. Pro allows 16,
              Scale 64.
            </span>
          </label>
        </div>
      </Panel>

      <Panel title="Behaviour">
        <ul className="flex flex-col divide-y divide-border">
          <Toggle
            label="Streaming responses"
            hint="Flush the response as the handler writes it, instead of buffering to the end."
            checked={draft.streaming_enabled}
            onChange={(on) => set('streaming_enabled', on)}
          />
          <Toggle
            label="WebSockets"
            hint="Allow upgrade requests. An open socket keeps the instance resident."
            checked={draft.websocket_enabled}
            onChange={(on) => set('websocket_enabled', on)}
          />
          <Toggle
            label="Per-route metrics"
            hint="Record latency and errors per route, so the Routes tab can list them. Paid plans."
            checked={draft.route_metrics_enabled}
            onChange={(on) => set('route_metrics_enabled', on)}
          />
          <Toggle
            label="Maintenance mode"
            hint="Answer every request with 503 and park. Deployments still work."
            checked={draft.maintenance_mode}
            onChange={(on) => set('maintenance_mode', on)}
          />
          <Toggle
            label="Require deploy tokens"
            hint="Every deployment call must carry a deploy token. Pro and Scale."
            checked={draft.require_authn}
            onChange={(on) => set('require_authn', on)}
          />
          <Toggle
            label="Warm snapshots"
            hint="Keep a second, post-traffic snapshot tier so a wake restores an already-warm process. Pro and Scale."
            checked={draft.warm_snapshot_enabled}
            onChange={(on) => set('warm_snapshot_enabled', on)}
          />
          {draft.warm_snapshot_enabled && (
            <li className="grid gap-5 py-4 sm:grid-cols-2">
              <NumberField
                label="Warm capture after (ms)"
                hint="Time since first-ready before the warm tier is captured. 100–60,000."
                value={draft.warm_snapshot_min_ms}
                min={100}
                onChange={(n) => set('warm_snapshot_min_ms', Math.min(60000, n))}
              />
              <NumberField
                label="Warm capture after (requests)"
                hint="Requests served before the warm tier is captured. 1–100."
                value={draft.warm_snapshot_min_requests}
                min={1}
                onChange={(n) => set('warm_snapshot_min_requests', Math.min(100, n))}
              />
            </li>
          )}
          <Toggle
            label="Default CORS headers"
            hint="Answer preflights at the edge with the origins below, before the app wakes."
            checked={draft.cors_default_enabled}
            onChange={(on) => set('cors_default_enabled', on)}
          />
          {draft.cors_default_enabled && (
            <li className="py-4">
              <label className="flex flex-col gap-1.5">
                <span className="label-mono text-muted-foreground">Allowed origins</span>
                <textarea
                  value={draft.cors_default_origins}
                  onChange={(e) => set('cors_default_origins', e.target.value)}
                  rows={2}
                  spellCheck={false}
                  placeholder={'https://app.example.com'}
                  className="rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-brand/50"
                />
                <span className="text-xs text-muted-foreground">One origin per line.</span>
              </label>
            </li>
          )}
          <li className="py-4">
            <p className="text-sm font-medium">Public URL auth</p>
            <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
              Gate the app's public URL before it wakes: bearer needs Hobby+, basic needs Pro+.
              Basic credentials are sealed at save and never shown again.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="flex gap-1.5">
                {(['open', 'bearer', 'basic'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={draft.public_auth_mode === mode}
                    onClick={() => set('public_auth_mode', mode)}
                    className={`pressable h-9 rounded-md border px-3 font-mono text-xs ${
                      draft.public_auth_mode === mode
                        ? 'border-brand bg-brand/10 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
              {draft.public_auth_mode === 'basic' && (
                <>
                  <input
                    value={draft.public_auth_user}
                    onChange={(e) => set('public_auth_user', e.target.value)}
                    placeholder="username"
                    autoComplete="off"
                    className={FIELD}
                  />
                  <input
                    type="password"
                    value={draft.public_auth_pass}
                    onChange={(e) => set('public_auth_pass', e.target.value)}
                    placeholder="password"
                    autoComplete="new-password"
                    className={FIELD}
                  />
                </>
              )}
            </div>
          </li>
        </ul>
      </Panel>
      <Modal
        open={preview !== null}
        onClose={() => setPreview(null)}
        title="What this change would do"
        description={preview ? `Plan ${preview.plan ?? ''} · ${app.slug}` : undefined}
        width="max-w-xl"
      >
        {preview && (
          <div className="flex flex-col gap-4">
            {(preview.diff?.changes?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No effective changes.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {preview.diff?.changes?.map((c) => (
                  <li
                    key={c.field}
                    className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-xs"
                  >
                    <span className="w-44 shrink-0 font-mono">{c.field}</span>
                    <span className="text-muted-foreground line-through">
                      {String(c.before ?? '—')}
                    </span>
                    <span aria-hidden className="text-muted-foreground/50">
                      →
                    </span>
                    <span className="text-foreground">{String(c.after ?? '—')}</span>
                  </li>
                ))}
              </ul>
            )}
            {(preview.diff?.breaks?.length ?? 0) > 0 && (
              <div>
                <p className="label-mono mb-1.5" style={{ color: 'var(--status-warning)' }}>
                  Breaking
                </p>
                <ul className="flex flex-col gap-1">
                  {preview.diff?.breaks?.map((b) => (
                    <li
                      key={String(b)}
                      className="text-xs"
                      style={{ color: 'var(--status-warning)' }}
                    >
                      {String(b)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.blocking && (
              <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
                This change is blocking — the deploy path would refuse it.
              </p>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

function RenamePanel({ app }: { app: App }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const rename = useRenameApp(app.slug);
  const [next, setNext] = useState(app.slug);
  const valid = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(next) && next !== app.slug;

  return (
    <Panel
      title="Name"
      description="The slug is also the subdomain: renaming changes the URL, and the old one stops answering."
    >
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid || rename.isPending) return;
          if (
            !(await confirm({
              title: `Rename ${app.slug} to ${next}?`,
              description: `https://${app.slug}.gregale.app stops answering as soon as this lands. Anything pointing at it — a custom domain, a webhook, a cron path — keeps working; anything pointing at the old hostname does not.`,
              confirmLabel: 'Rename',
            }))
          )
            return;
          void rename
            .mutateAsync(next)
            .then(() => {
              toast({ kind: 'success', title: `Renamed to ${next}` });
              void navigate({
                to: '/dashboard/workflows/$workflowId',
                params: { workflowId: next },
                search: { tab: 'Configuration' },
              });
            })
            .catch((err: unknown) =>
              toast({ kind: 'error', title: 'Could not rename', description: errorMessage(err) })
            );
        }}
      >
        <label className="flex min-w-64 flex-1 flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Slug</span>
          <input
            value={next}
            onChange={(e) => setNext(e.target.value.toLowerCase())}
            spellCheck={false}
            className={FIELD}
          />
        </label>
        <Button type="submit" size="sm" variant="outline" disabled={!valid} busy={rename.isPending}>
          Rename
        </Button>
      </form>
    </Panel>
  );
}

function DangerZone({ app }: { app: App }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const remove = useDeleteApp();

  return (
    <Panel
      title="Danger zone"
      description="Permanent. The console asks you to type the slug before it goes through."
      className="border-[color:color-mix(in_oklab,var(--status-critical)_35%,transparent)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">Delete {app.slug}</p>
          <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
            Every deployment, secret, env var, domain binding, and queue message goes with it. There
            is no grace period for an app.
          </p>
        </div>
        <Button
          size="sm"
          variant="destructive"
          busy={remove.isPending}
          onClick={async () => {
            if (
              !(await confirm({
                title: `Delete ${app.slug}?`,
                description:
                  'This cannot be undone. Traffic to its URL and any bound domain starts failing immediately.',
                confirmLabel: 'Delete app',
                destructive: true,
                typeToConfirm: app.slug,
              }))
            )
              return;
            void remove
              .mutateAsync(app.slug)
              .then(() => {
                toast({ kind: 'success', title: `Deleted ${app.slug}` });
                void navigate({ to: '/dashboard/workflows' });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not delete', description: errorMessage(err) })
              );
          }}
        >
          Delete app
        </Button>
      </div>
    </Panel>
  );
}

export function AppConfiguration({ slug }: { slug: string }) {
  const { data, isPending, error, refetch } = useApp(slug);
  const phase = queryPhase({ error, loading: isPending });

  if (phase === 'unreachable') return <UnreachableState onRetry={() => void refetch()} />;
  if (phase === 'error') return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (phase === 'loading' || !data) return <LoadingState message="Loading configuration…" />;

  return (
    <div className="flex flex-col gap-6">
      <Panel title="About" padded={false}>
        <dl className="grid gap-x-8 gap-y-0 px-5 sm:grid-cols-3">
          {[
            ['Runtime', data.runtime ?? data.type],
            ['Type', data.type],
            ['Endpoint', data.url],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-1 py-4">
              <dt className="label-mono text-muted-foreground">{label}</dt>
              <dd className="truncate font-mono text-sm">{value}</dd>
            </div>
          ))}
        </dl>
      </Panel>
      {/* Keyed on the id so a rename or a fresh read reseeds the draft. */}
      <ConfigForm key={`${data.id}:${data.slug}`} app={data} />
      <SupplyChainPanel slug={data.slug} />
      <RegistryCredentialsPanel slug={data.slug} />
      <RenamePanel key={`rename:${data.slug}`} app={data} />
      <DangerZone app={data} />
    </div>
  );
}
