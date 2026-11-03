import { useState, type ReactNode } from 'react';
import { useCapabilityStage } from '@/lib/api/capabilities';
import {
  deploymentScope,
  useReleaseDiff,
  useServingRows,
  type ReleaseDiff,
} from '@/lib/api/deployment-detail';
import type { Deployment } from '@/lib/api/queries';
import { CliCommand } from './cli-command';
import { InlinePhase, queryPhase } from './primitives';
import { SegmentedControl } from './tabs';

type Package = ReleaseDiff['dependencies']['added'][number];

/** The release's customer handle: `v42` when it has one, else its short id. */
export function releaseLabel(side: { deployment_id: string; revision?: number }): string {
  return side.revision ? `v${side.revision}` : side.deployment_id.slice(0, 8);
}

/** The API only builds GitHub compare links (releasediff.go:97); anything else is not a link. */
function safeCompareUrl(raw?: string): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

const short = (commit?: string) => (commit ? commit.slice(0, 7) : '—');

/** The CLI's handle for a release: `v42`, or its full id when it has no revision. */
const cliRef = (side: { deployment_id: string; revision?: number }) =>
  side.revision ? `v${side.revision}` : side.deployment_id;
const sameId = (a?: string, b?: string) =>
  Boolean(a && b) && a!.replace(/-/g, '').toLowerCase() === b!.replace(/-/g, '').toLowerCase();

/**
 * What a release changed against the one that served before it
 * (GET /v1/deployments/{id}/diff, ADR-20261021101117), or against what serves
 * now: for a release still queued, building or in a canary, the predecessor
 * the API picks is not always the release it would replace, so the serving
 * releases of its scope (read from the app's history, `useServingRows`) are
 * offered as `?against=` — the CLI's `gregale release diff --against`. The
 * API compares keys, never values, and reports a section it cannot reach as
 * unknown with a note, which is shown as such rather than as "nothing
 * changed".
 */
export function DeploymentDiff({
  deploymentId,
  slug,
  deployment,
}: {
  deploymentId: string;
  /** With the release itself, enables comparing with what serves now. */
  slug?: string;
  deployment?: Deployment;
}) {
  const stage = useCapabilityStage('deploy-diff');
  const [picked, setPicked] = useState('');
  const servingRead = useServingRows(
    slug ?? '',
    deployment ? deploymentScope(deployment) : 'default',
    { enabled: Boolean(slug && deployment) }
  );
  const serving = slug && deployment ? servingRead.data : undefined;
  const others = (serving?.rows ?? []).filter((row) => !sameId(row.id, deploymentId));
  const base = useReleaseDiff(deploymentId);
  const predecessor = base.data?.from?.deployment_id;
  const choices = others.filter((row) => !sameId(row.id, predecessor));
  // A pick that stops serving (the rollout moved on) falls back to the default.
  const selected = choices.find((row) => row.id === picked);
  const against = selected?.id ?? '';
  const chosen = useReleaseDiff(against ? deploymentId : '', against || undefined);
  const query = against ? chosen : base;
  const diff = query.data;
  const phase = queryPhase({ error: query.error, loading: query.isPending, isEmpty: !diff });
  const split = (serving?.rows.length ?? 0) > 1;
  const predecessorServes = Boolean(
    predecessor && others.some((row) => sameId(row.id, predecessor))
  );
  const command = diff
    ? `gregale release diff ${cliRef(diff.to)}${selected ? ` --against ${cliRef({ deployment_id: selected.id, revision: selected.revision })}` : ''} --app ${slug}`
    : undefined;

  return (
    <section aria-label="What changed" className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 label-mono text-muted-foreground">
          What changed
          {stage && <span className="rounded-full border border-border px-2 py-0.5">{stage}</span>}
        </p>
        {choices.length > 0 && (
          <SegmentedControl
            label="Compare with"
            value={against}
            options={[
              { key: '', label: 'Release before it' },
              ...choices.map((row) => ({
                key: row.id,
                label: `Serving ${cliRef({ deployment_id: row.id.slice(0, 8), revision: row.revision })}${split ? ` · ${row.traffic_percent ?? 0}%` : ''}`,
              })),
            ]}
            onChange={setPicked}
          />
        )}
      </div>
      {!against && predecessorServes && base.data?.from && (
        <p className="mt-1 text-xs text-muted-foreground">
          {releaseLabel(base.data.from)} serves now, so this is what the release would change.
        </p>
      )}
      {serving && !serving.complete && others.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          What serves now is not in the releases read from the app’s history, so only the release
          before it is offered.
        </p>
      )}
      {phase !== 'ready' || !diff ? (
        <div className="mt-3">
          <InlinePhase
            phase={phase}
            error={query.error}
            loadingMessage="Comparing releases…"
            emptyMessage="No comparison is available."
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : (
        <DiffBody diff={diff} />
      )}
      {slug && command && (
        <div className="mt-4">
          <CliCommand
            command={command}
            label="The same comparison from the CLI"
            copyLabel={`release diff command for ${cliRef(diff!.to)}`}
          />
        </div>
      )}
    </section>
  );
}

function DiffBody({ diff }: { diff: ReleaseDiff }) {
  const compare = safeCompareUrl(diff.code.compare_url);
  const from = diff.from;
  return (
    <div className="mt-2 flex flex-col gap-4">
      <p className="text-sm">
        {from ? (
          <>
            <span className="font-mono">{releaseLabel(diff.to)}</span> against{' '}
            <span className="font-mono">{releaseLabel(from)}</span>: {diff.summary}
          </>
        ) : (
          <>
            <span className="font-mono">{releaseLabel(diff.to)}</span> is the app&apos;s first
            release, so there is nothing earlier to compare with.
          </>
        )}
      </p>
      {from && (
        <>
          <Section title="Code">
            {diff.code.changed || diff.code.image_changed ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                <span className="font-mono">
                  {short(diff.code.from_commit)} → {short(diff.code.to_commit)}
                </span>
                {diff.code.image_changed && (
                  <span className="text-muted-foreground">The image changed.</span>
                )}
                {compare && (
                  <a
                    href={compare}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-brand underline underline-offset-4"
                  >
                    Compare on GitHub
                  </a>
                )}
              </p>
            ) : (
              <Unchanged />
            )}
          </Section>
          <Section
            title="Configuration"
            hint="Variables and secrets by key. Values are never shown."
            unknown={diff.config.known ? undefined : diff.config.note}
          >
            {diff.config.variables.length + diff.config.secrets.length === 0 ? (
              <Unchanged />
            ) : (
              <ul className="flex flex-col gap-1 text-xs">
                {diff.config.variables.map((key) => (
                  <KeyChange
                    key={`v-${key.key}`}
                    name={key.key}
                    kind="variable"
                    change={key.change}
                  />
                ))}
                {diff.config.secrets.map((key) => (
                  <KeyChange
                    key={`s-${key.key}`}
                    name={key.key}
                    kind="secret"
                    change={key.change}
                  />
                ))}
              </ul>
            )}
          </Section>
          <Section
            title="Packages"
            hint={
              diff.dependencies.truncated
                ? 'From the two builds’ SBOMs. Lists are cut at most 100 per list.'
                : 'From the two builds’ SBOMs.'
            }
            unknown={diff.dependencies.known ? undefined : diff.dependencies.note}
          >
            <Packages deps={diff.dependencies} />
          </Section>
          <Section title="Runtime settings">
            {diff.runtime.length === 0 ? (
              <Unchanged />
            ) : (
              <dl className="grid gap-1 text-xs">
                {diff.runtime.map((field) => (
                  <div key={field.field} className="flex min-w-0 flex-wrap gap-x-2">
                    <dt className="font-mono">{field.field}</dt>
                    <dd className="min-w-0 font-mono text-muted-foreground [overflow-wrap:anywhere]">
                      {field.from || '—'} → {field.to || '—'}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Section>
        </>
      )}
      <Section title="Release command" hint="The step that runs database migrations.">
        {diff.database.changed ? (
          <p className="font-mono text-xs [overflow-wrap:anywhere]">
            {from ? `${diff.database.from_release_command || '—'} → ` : ''}
            {diff.database.to_release_command || '—'}
          </p>
        ) : (
          <Unchanged />
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  hint,
  unknown,
  children,
}: {
  title: string;
  hint?: string;
  unknown?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 border-t border-border pt-3">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-2">
        {unknown !== undefined ? (
          <p className="text-xs text-muted-foreground">Unknown{unknown ? `: ${unknown}.` : '.'}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function Unchanged() {
  return <p className="text-xs text-muted-foreground">Unchanged.</p>;
}

function KeyChange({ name, kind, change }: { name: string; kind: string; change: string }) {
  return (
    <li className="flex flex-wrap gap-x-2">
      <span className="font-mono">{name}</span>
      <span className="text-muted-foreground">
        {kind} {change}
      </span>
    </li>
  );
}

function Packages({ deps }: { deps: ReleaseDiff['dependencies'] }) {
  const rows: [string, Package[]][] = [
    ['Added', deps.added],
    ['Removed', deps.removed],
    ['Upgraded', deps.changed],
  ];
  if (rows.every(([, list]) => list.length === 0)) return <Unchanged />;
  return (
    <div className="flex flex-col gap-2 text-xs">
      {rows
        .filter(([, list]) => list.length > 0)
        .map(([label, list]) => (
          <div key={label}>
            <p className="text-muted-foreground">
              {label} ({list.length})
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {list.map((pkg) => (
                <li key={pkg.name} className="font-mono [overflow-wrap:anywhere]">
                  {pkg.name}{' '}
                  <span className="text-muted-foreground">
                    {pkg.from && pkg.to ? `${pkg.from} → ${pkg.to}` : (pkg.to ?? pkg.from ?? '')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  );
}
