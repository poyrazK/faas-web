import type { EnvironmentDiff } from '@/lib/api/projects';
import type { components } from '@/lib/api/schema';
import type { ReactNode } from 'react';
import { Check, WarningCircle } from 'iconoir-react';
import { DetailDisclosure } from '../detail-disclosure';
import { SharedResources } from './environment-state';
import { describeDifferences, environmentName, groupLabel } from './environment-words';
type SecretCell = components['schemas']['ProjectEnvironmentSecretCellResponse'];
function secretMetadata(cell: SecretCell) {
  if (!cell.present) return 'Not present';
  return `${cell.value_hash ? `Fingerprint ${cell.value_hash}` : 'Fingerprint unknown'}, version ${cell.version ?? 'unknown'}${cell.managed_by ? `, ${cell.managed_by}` : ''}${cell.binding_id ? `, binding ${cell.binding_id}` : ''}${cell.credential_generation !== undefined ? `, generation ${cell.credential_generation}` : ''}`;
}
/**
 * What differs between two environments, as sentences grouped by app. Ids,
 * fingerprints and before/after values stay behind "Technical details".
 */
export function EnvironmentDifferences({
  data,
  control,
}: {
  data: EnvironmentDiff;
  /** The "compare with" choice, shown beside the heading. */
  control?: ReactNode;
}) {
  const words = describeDifferences(data);
  const total = data.workloads.length;
  const nothing = !words.groups.length && !words.configuration;
  return (
    <section
      aria-labelledby="environment-differences"
      className="surface flex flex-col gap-4 rounded-[1.25rem] bg-card p-5 sm:p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="environment-differences" className="text-lg font-semibold tracking-[-0.01em]">
            What&apos;s different
          </h2>
          <p className="text-[13px] text-muted-foreground">
            {environmentName(data.from_environment)} compared with{' '}
            {environmentName(data.to_environment)}
          </p>
        </div>
        {control}
      </header>
      {!total ? (
        <p className="text-sm text-muted-foreground">No apps to compare.</p>
      ) : (
        <ul className="flex flex-col gap-3 text-sm">
          {words.configuration && (
            <li className="flex gap-2.5">
              <WarningCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
              <span>{words.configuration}</span>
            </li>
          )}
          {words.groups.map((group) => (
            <li key={group.apps.join(',')} className="flex gap-2.5">
              <WarningCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium">{groupLabel(group.apps, total)}</span>
                {group.lines.map((line) => (
                  <span key={line} className="text-foreground/85">
                    {line}
                  </span>
                ))}
              </div>
            </li>
          ))}
          {nothing && (
            <li className="flex gap-2.5">
              <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-status-good" />
              <span>No differences Gregale can see.</span>
            </li>
          )}
          {words.same && (
            <li className="flex gap-2.5 text-muted-foreground">
              <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-status-good" />
              <span>{words.same}</span>
            </li>
          )}
        </ul>
      )}
      <DetailDisclosure title="Technical details" summary="ids, fingerprints, before and after">
        <EnvironmentDiffTechnical data={data} />
      </DetailDisclosure>
    </section>
  );
}

/** The comparison as the API reports it: before / after for every field. */
export function EnvironmentDiffTechnical({ data }: { data: EnvironmentDiff }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-4 text-sm">
        <p className="text-xs text-muted-foreground">
          Snapshot {data.generated_at}. A missing fingerprint does not mean the values are equal.
        </p>
        <p>
          Configuration versions: {data.configuration.from_version} /{' '}
          {data.configuration.to_version}
        </p>
        {data.configuration.changes.length > 0 && (
          <details>
            <summary className="cursor-pointer">
              Configuration changes ({data.configuration.changes.length})
            </summary>
            <ul className="mt-2 space-y-2">
              {data.configuration.changes.map((change) => (
                <li key={change.key} className="break-all">
                  {change.key}: {change.kind}
                  <pre className="max-h-32 overflow-auto text-xs">
                    {JSON.stringify({ before: change.before, after: change.after }, null, 2)}
                  </pre>
                </li>
              ))}
            </ul>
          </details>
        )}
        {data.workloads.map((workload) => (
          <details key={workload.workload_slug} open className="well rounded-xl bg-muted/40 p-3">
            <summary className="cursor-pointer font-medium">{workload.workload_name}</summary>
            <div className="mt-3 space-y-3">
              <p>
                Release: {workload.release.kind}.{' '}
                {workload.release.before?.deployment_id ||
                  workload.release.before?.status ||
                  'Unknown'}{' '}
                /{' '}
                {workload.release.after?.deployment_id ||
                  workload.release.after?.status ||
                  'Unknown'}
              </p>
              <p>
                Routes: {workload.routes.kind}, {workload.routes.before?.ownership ?? 'unknown'} /{' '}
                {workload.routes.after?.ownership ?? 'unknown'}. Headers/CORS:{' '}
                {workload.policies.kind}, {workload.policies.before?.ownership ?? 'unknown'} /{' '}
                {workload.policies.after?.ownership ?? 'unknown'}.
              </p>
              {workload.variables.length > 0 && (
                <details>
                  <summary className="cursor-pointer">
                    Runtime variable changes ({workload.variables.length})
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {workload.variables.map((variable) => (
                      <li key={variable.key} className="break-all whitespace-pre-wrap">
                        {variable.key}: {variable.kind}
                        <p>
                          {variable.before ?? 'Not present'} / {variable.after ?? 'Not present'}
                        </p>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {workload.secrets.length > 0 && (
                <div>
                  <h4 className="font-medium">Secret metadata changes</h4>
                  <ul className="mt-2 space-y-3">
                    {workload.secrets.map((secret) => (
                      <li key={secret.key}>
                        <span>{secret.key}: </span>
                        <span>{secret.kind}</span>
                        <p className="break-all text-xs text-muted-foreground">
                          {secretMetadata(secret.before)} / {secretMetadata(secret.after)}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {workload.bindings.length > 0 && (
                <ul className="space-y-2">
                  {workload.bindings.map((binding) => (
                    <li key={binding.binding_id} className="break-all">
                      {binding.kind}: {binding.change}, binding {binding.binding_id}, generation{' '}
                      {binding.before?.credential_generation ?? 'unknown'} /{' '}
                      {binding.after?.credential_generation ?? 'unknown'}
                    </li>
                  ))}
                </ul>
              )}
              <p>Domains: {workload.domains.kind}</p>
            </div>
          </details>
        ))}
        {!data.workloads.length && <p>No workload comparisons were returned.</p>}
      </div>
      <SharedResources items={data.shared_resources} />
    </div>
  );
}
