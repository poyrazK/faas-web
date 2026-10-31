import type { ReactNode } from 'react';
import { useReleaseDiff, type ReleaseDiff } from '@/lib/api/deployment-detail';
import { InlinePhase, queryPhase } from './primitives';

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

/**
 * What a release changed against the one that served before it
 * (GET /v1/deployments/{id}/diff, ADR-20261021101117). The API compares keys,
 * never values, and reports a section it cannot reach as unknown with a note,
 * which is shown as such rather than as "nothing changed".
 */
export function DeploymentDiff({ deploymentId }: { deploymentId: string }) {
  const query = useReleaseDiff(deploymentId);
  const diff = query.data;
  const phase = queryPhase({ error: query.error, loading: query.isPending, isEmpty: !diff });

  return (
    <section aria-label="What changed" className="rounded-lg border border-border p-4">
      <p className="label-mono text-muted-foreground">What changed</p>
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
