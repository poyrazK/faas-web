import type { EnvironmentState } from '@/lib/api/projects';
import { Panel } from '../primitives';
import { publicAppUrl } from '@/lib/app-url';
export function SharedResources({ items }: { items: EnvironmentState['shared_resources'] }) {
  return (
    items.length > 0 && (
      <div className="border-t border-border p-4 text-sm">
        <h3 className="mb-2 font-medium">Shared resources</h3>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.kind}>
              <span className="font-medium">{item.kind}</span>{' '}
              <span className="text-muted-foreground">({item.ownership})</span>
              <p>{item.note}</p>
            </li>
          ))}
        </ul>
      </div>
    )
  );
}
export function EnvironmentStateView({ data }: { data: EnvironmentState }) {
  return (
    <Panel
      title="Effective environment state"
      description={`Snapshot ${data.generated_at}. Read-only; this is not a clone-completeness report.`}
    >
      <div className="space-y-4 p-4 text-sm">
        <div>
          <h3 className="font-medium">Active release graph</h3>
          {data.active_release_set ? (
            <>
              <p className="break-all">
                {data.active_release_set.id} ({data.release_set_status ?? 'Unknown'})
              </p>
              <ul className="mt-2 space-y-1">
                {data.active_release_set.members.map((member) => (
                  <li key={member.app_id} className="break-all">
                    App {member.app_id}: deployment {member.deployment_id}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-muted-foreground">
                Selected graph members can differ from the per-workload live releases below.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              {data.release_set_status === 'none'
                ? 'No active release graph'
                : 'Release graph unavailable'}
            </p>
          )}
        </div>
        <details>
          <summary className="cursor-pointer font-medium">
            Configuration version {data.configuration.version}
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">
            {JSON.stringify(data.configuration.values, null, 2)}
          </pre>
          <p className="mt-2 break-all text-xs text-muted-foreground">
            Configuration fingerprint: {data.configuration.config_hash}
          </p>
        </details>
        {!data.workloads.length && <p>No workloads in this environment.</p>}
        {data.workloads.map((workload) => (
          <details
            key={workload.workload_slug}
            className="rounded-md border border-border p-3"
            open
          >
            <summary className="cursor-pointer font-medium">
              {workload.workload_name}{' '}
              <span className="text-muted-foreground">({workload.release.status})</span>
            </summary>
            <div className="mt-3 space-y-3">
              <dl className="grid gap-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Live deployment</dt>
                  <dd className="break-all">{workload.release.deployment_id || 'Not deployed'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Artifact</dt>
                  <dd className="break-all">
                    {workload.release.image_digest ||
                      workload.release.source_sha256 ||
                      workload.release.commit_sha ||
                      'Unknown'}
                  </dd>
                </div>
              </dl>
              {publicAppUrl(workload.release.url) && (
                <a
                  href={publicAppUrl(workload.release.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand hover:underline"
                >
                  Open environment app
                </a>
              )}
              <p className="text-xs text-muted-foreground">
                Routes: {workload.routes.ownership}, {workload.routes.declared_routes.length}{' '}
                declarations. Headers/CORS: {workload.policies.ownership},{' '}
                {workload.policies.rules.length} rules.
              </p>
              <details>
                <summary className="cursor-pointer">
                  Runtime variables ({workload.variables.length})
                </summary>
                <dl className="mt-2 space-y-2">
                  {workload.variables.map((variable) => (
                    <div key={variable.key}>
                      <dt className="font-medium">{variable.key}</dt>
                      <dd className="break-all whitespace-pre-wrap">{variable.value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              <details>
                <summary className="cursor-pointer">
                  Secret metadata ({workload.secrets.length})
                </summary>
                <ul className="mt-2 space-y-2">
                  {workload.secrets.map((secret) => (
                    <li key={secret.key} className="break-all">
                      {secret.key}: fingerprint {secret.value_hash || 'unknown'}, version{' '}
                      {secret.version ?? 'unknown'}
                      {secret.managed_by && `, managed by ${secret.managed_by}`}
                      {secret.binding_id && `, binding ${secret.binding_id}`}
                      {secret.credential_generation !== undefined &&
                        `, generation ${secret.credential_generation}`}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">
                  Values and sealing details are never shown.
                </p>
              </details>
              <details>
                <summary className="cursor-pointer">
                  Managed bindings ({workload.bindings.length})
                </summary>
                <ul className="mt-2 space-y-2">
                  {workload.bindings.map((binding) => (
                    <li key={binding.binding_id} className="break-all">
                      {binding.kind}: {binding.binding_id}, generation{' '}
                      {binding.credential_generation ?? 'unknown'}, keys{' '}
                      {binding.secret_keys.join(', ')}
                    </li>
                  ))}
                </ul>
              </details>
              {workload.domains.length > 0 && (
                <p className="break-all">
                  Domains:{' '}
                  {workload.domains
                    .map(
                      (domain) =>
                        `${domain.domain} (${domain.verified ? 'verified' : 'unverified'})`
                    )
                    .join(', ')}
                </p>
              )}
            </div>
          </details>
        ))}
      </div>
      <SharedResources items={data.shared_resources} />
    </Panel>
  );
}
