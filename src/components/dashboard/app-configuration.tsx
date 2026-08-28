import { useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { FIELD as BASE_FIELD } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/api/errors';
import { useApp, useDeleteApp, useRenameApp, useUpdateApp, type App } from '@/lib/api/queries';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { ErrorState, LoadingState, Panel, UnreachableState, queryPhase } from './primitives';
import { RegistryCredentialsPanel } from './app-core-panels';

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
};

function draftFrom(app: App): Draft {
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
  const [draft, setDraft] = useState<Draft>(() => draftFrom(app));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Only what changed goes over the wire: a PATCH that restates every field
  // also restates every field the person did not mean to touch.
  const changes = useMemo(() => {
    const base = draftFrom(app);
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(draft) as (keyof Draft)[]) {
      if (draft[key] !== base[key]) {
        out[key] =
          key === 'egress_allowlist'
            ? draft.egress_allowlist
                .split('\n')
                .map((l) => l.trim())
                .filter(Boolean)
            : draft[key];
      }
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
          <Button size="sm" disabled={!dirty} busy={update.isPending} onClick={save}>
            Save changes
          </Button>
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
        </ul>
      </Panel>
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
      <RegistryCredentialsPanel slug={data.slug} />
      <RenamePanel key={`rename:${data.slug}`} app={data} />
      <DangerZone app={data} />
    </div>
  );
}
