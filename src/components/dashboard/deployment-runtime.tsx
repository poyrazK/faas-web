import { useState } from 'react';
import { Select } from '@/components/ui/field';
import {
  useDeploymentRuntime,
  useRuntimeUpgradePreview,
  type RuntimeRelease,
  type RuntimeUpgradePreview,
} from '@/lib/api/deployment-detail';
import { InlinePhase, queryPhase } from './primitives';

const STATUS: Record<string, string> = {
  pinned: 'Pinned',
  unknown: 'Not recorded',
  unsupported: 'Not managed by Gregale',
};

const DISPOSITION: Record<RuntimeUpgradePreview['disposition'], string> = {
  blocked: 'Blocked',
  no_change: 'No change: this is the base the release already runs on',
  review_required: 'Review required',
};

const CHANGE: Record<RuntimeUpgradePreview['changes'][number], string> = {
  runtime_source: 'Runtime source image',
  guest_init: 'Guest init (the VM’s first process)',
  base_layout: 'Base layout version',
  base_bytes: 'Base filesystem bytes',
};

const day = (iso: string) => iso.slice(0, 10);

/**
 * The exact runtime base a Gregale-managed function artifact boots from, and
 * a read-only comparison with another published base
 * (handlers_runtime_releases.go). The API has no runtime update operation
 * (`execution_available` is always false), so nothing here applies anything.
 */
export function DeploymentRuntime({ deploymentId }: { deploymentId: string }) {
  const runtime = useDeploymentRuntime(deploymentId);
  const [target, setTarget] = useState('');
  const preview = useRuntimeUpgradePreview(deploymentId, target);
  const data = runtime.data;
  const phase = queryPhase({ error: runtime.error, loading: runtime.isPending, isEmpty: !data });
  const current = data?.current ?? undefined;
  const candidates = (data?.releases ?? []).filter((release) => release.id !== current?.id);

  return (
    <section aria-label="Runtime base" className="rounded-lg border border-border p-4">
      <p className="label-mono text-muted-foreground">Runtime base</p>
      {phase !== 'ready' || !data ? (
        <div className="mt-3">
          <InlinePhase
            phase={phase}
            error={runtime.error}
            loadingMessage="Reading the runtime base…"
            onRetry={() => void runtime.refetch()}
          />
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-sm">
            {STATUS[data.status] ?? data.status}.{' '}
            <span className="text-muted-foreground">{data.reason}</span>
          </p>
          {current && <ReleaseFields release={current} />}
          {current && candidates.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Compare with a published base</span>
                <span className="text-xs text-muted-foreground">
                  A preview only. Publication does not prove a base is compatible, and Gregale
                  cannot apply a runtime update yet.
                </span>
                <Select
                  aria-label="Compare with a published base"
                  value={target}
                  onChange={(event) => setTarget(event.target.value)}
                  className="mt-1 max-w-md font-mono text-xs"
                >
                  <option value="">Choose a base…</option>
                  {candidates.map((release) => (
                    <option key={release.id} value={release.id}>
                      {release.runtime} · {release.architecture} · published{' '}
                      {day(release.published_at)} · {release.id.slice(0, 12)}
                    </option>
                  ))}
                </Select>
              </label>
              {target && (
                <div aria-live="polite">
                  {preview.data ? (
                    <PreviewBody preview={preview.data} />
                  ) : (
                    <InlinePhase
                      phase={queryPhase({ error: preview.error, loading: preview.isPending })}
                      error={preview.error}
                      loadingMessage="Comparing bases…"
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ReleaseFields({ release }: { release: RuntimeRelease }) {
  const fields: [string, string][] = [
    ['Runtime', `${release.runtime} · ${release.architecture}`],
    ['Published', day(release.published_at)],
    ['Base bytes', release.base_digest],
    ['Guest init', release.guest_init_digest],
    ['Source image', release.source_digest],
    ['Layout', release.layout_version],
  ];
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      {fields.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="label-mono text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 font-mono text-xs [overflow-wrap:anywhere]">{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function PreviewBody({ preview }: { preview: RuntimeUpgradePreview }) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted px-3 py-2 text-xs">
      <p className="text-sm font-medium">{DISPOSITION[preview.disposition]}</p>
      {preview.changes.length > 0 && (
        <List title="What would change" items={preview.changes.map((change) => CHANGE[change])} />
      )}
      {(preview.rebuild_required || preview.cold_start_required) && (
        <p className="text-muted-foreground">
          Moving to this base needs a rebuild and a cold start: existing snapshots cannot be reused
          across different base bytes.
        </p>
      )}
      {preview.blockers.length > 0 && <List title="Blockers" items={preview.blockers} />}
      {preview.required_steps.length > 0 && (
        <List title="Steps before a guarded rollout" items={preview.required_steps} ordered />
      )}
    </div>
  );
}

function List({ title, items, ordered }: { title: string; items: string[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul';
  return (
    <div>
      <p className="label-mono text-muted-foreground">{title}</p>
      <Tag className={ordered ? 'mt-1 list-decimal pl-4' : 'mt-1 list-disc pl-4'}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </Tag>
    </div>
  );
}
