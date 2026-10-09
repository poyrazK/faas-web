import type { EnvironmentDiff } from '@/lib/api/projects';
import type { components } from '@/lib/api/schema';
import { Panel } from '../primitives';
import { SharedResources } from './environment-state';
type SecretCell = components['schemas']['ProjectEnvironmentSecretCellResponse'];
function secretMetadata(cell: SecretCell) {
  if (!cell.present) return 'Not present';
  return `${cell.value_hash ? `Fingerprint ${cell.value_hash}` : 'Fingerprint unknown'}, version ${cell.version ?? 'unknown'}${cell.managed_by ? `, ${cell.managed_by}` : ''}${cell.binding_id ? `, binding ${cell.binding_id}` : ''}${cell.credential_generation !== undefined ? `, generation ${cell.credential_generation}` : ''}`;
}
export function EnvironmentDiffView({ data }: { data: EnvironmentDiff }) {
  return (
    <Panel
      title={`${data.from_environment} compared with ${data.to_environment}`}
      description={`Snapshot ${data.generated_at}. Server-reported differences; missing fingerprints are not equality.`}
    >
      <div className="space-y-4 p-4 text-sm">
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
          <details
            key={workload.workload_slug}
            open
            className="rounded-md border border-border p-3"
          >
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
    </Panel>
  );
}
