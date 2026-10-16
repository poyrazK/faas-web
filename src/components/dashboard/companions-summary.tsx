import { useAuth } from '@/lib/auth';
import { useCapability } from '@/lib/api/capabilities';
import { useCompanionChoices, useCompanions, type Companion } from '@/lib/api/companions';
import { Button } from '@/components/ui/button';
import { Panel } from './primitives';
import { CapabilityNotice } from './capability-notice';

function declared(value: number, unit: string) {
  return value ? `${value} ${unit}` : 'Inherited default';
}
function Declaration({ row }: { row: Companion }) {
  return (
    <li className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-medium">{row.name}</h3>
        <span className="text-muted-foreground">
          {row.type === 'init' ? 'Init workload' : 'Long-running sidecar'}
        </span>
      </div>
      <p>Execution health: Unverified. No runtime telemetry was returned.</p>
      {row.image && <p className="break-all font-mono text-xs">{row.image}</p>}
      {row.preset && <p>Declared preset: {row.preset}</p>}
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-muted-foreground">Declared memory</dt>
          <dd>{declared(row.ram_mb, 'MiB')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Declared CPU</dt>
          <dd>{declared(row.cpu_millicores, 'millicores')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Declared scratch</dt>
          <dd>{declared(row.scratch_mb, 'MiB')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Disk policy</dt>
          <dd>{row.disk_io_profile ?? 'Inherited default'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Declared port</dt>
          <dd>{row.port || 'No explicit port'}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Lifecycle policy</dt>
          <dd>
            {row.essential === false ? 'Non-essential' : 'Essential'}
            {row.primary_ingress ? ' · Primary ingress' : ''}
          </dd>
        </div>
      </dl>
      <p>
        Configured ceilings are separate from effective allocation and observed usage. A declared
        port does not prove a listener is running.
      </p>
      <div>
        <p className="text-muted-foreground">Declared dependencies</p>
        {row.depends_on.length ? (
          <ul>
            {row.depends_on.map((d) => (
              <li key={d.name}>
                {d.name}: {d.condition ?? 'started'}
              </li>
            ))}
          </ul>
        ) : (
          <p>No explicit dependencies.</p>
        )}
      </div>
      <div>
        <p className="text-muted-foreground">Environment key names</p>
        {row.environment_keys.length ? (
          <ul className="flex flex-wrap gap-2">
            {row.environment_keys.map((k) => (
              <li key={k} className="font-mono text-xs">
                {k}
              </li>
            ))}
          </ul>
        ) : (
          <p>No explicit environment keys.</p>
        )}
        <p className="mt-1 text-muted-foreground">
          Values and secret references are never displayed.
        </p>
      </div>
    </li>
  );
}
export function CompanionsSummary({
  slug,
  selectedId,
  before,
  onSelect,
}: {
  slug: string;
  selectedId?: string;
  before?: string;
  onSelect: (id?: string, before?: string) => void;
}) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const capability = useCapability('companions');
  const choices = useCompanionChoices(accountId, slug, before);
  const id =
    selectedId ??
    (!choices.error && !choices.isFetching ? choices.data?.items[0]?.id : undefined) ??
    '';
  const declarations = useCompanions(accountId, slug, id);
  const data =
    !declarations.error &&
    !declarations.isFetching &&
    !choices.error &&
    !choices.isFetching &&
    declarations.data?.account_id === accountId &&
    declarations.data.app_slug === slug &&
    declarations.data.deployment_id === id &&
    declarations.data.app_id === choices.data?.appId
      ? declarations.data
      : undefined;
  return (
    <div className="space-y-5">
      <Panel
        title="Deployment companions"
        description="Inspect declarations for an exact deployment. Configuration is separate from execution health."
      >
        <div className="space-y-4 p-4 text-sm">
          <CapabilityNotice
            capability={capability.capability}
            state={capability.state}
            onRetry={capability.refresh}
          />
          <p>
            Availability describes new companion deployment support. Existing declarations can still
            be inspected when creation or preset qualification is unavailable.
          </p>
          {choices.isPending || choices.isFetching ? (
            <p role="status">Loading deployment choices…</p>
          ) : choices.error ? (
            <div role="alert">
              <p>
                Could not read deployment choices. Permission, MFA or account context may need
                attention.
              </p>
              <Button variant="outline" onClick={() => void choices.refetch()}>
                Retry choices
              </Button>
            </div>
          ) : (
            choices.data && (
              <>
                <label className="flex flex-col gap-1.5">
                  <span>Deployment</span>
                  <select
                    aria-label="Deployment"
                    className="w-full min-w-0 rounded-md border border-border bg-background p-2"
                    value={id}
                    onChange={(e) => onSelect(e.target.value, before)}
                  >
                    {!id && <option value="">Choose a deployment</option>}
                    {id && !choices.data.items.some((row) => row.id === id) && (
                      <option value={id}>Selected record · {id}</option>
                    )}
                    {choices.data.items.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.id} · {row.status} · {row.createdAt}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  {before && (
                    <Button variant="outline" onClick={() => onSelect(undefined, undefined)}>
                      Newest deployments
                    </Button>
                  )}
                  {choices.data.nextBefore && (
                    <Button
                      variant="outline"
                      onClick={() => onSelect(undefined, choices.data?.nextBefore)}
                    >
                      Older deployments
                    </Button>
                  )}
                </div>
                {choices.data.items.length === 0 && !selectedId && (
                  <p>
                    No deployment records on this page. Deploy a reviewed source before inspecting
                    companions.
                  </p>
                )}
              </>
            )
          )}
          {id && (declarations.isPending || declarations.isFetching) && (
            <p role="status">Loading deployment declarations…</p>
          )}
          {id && declarations.error && (
            <div role="alert">
              <p>
                Declaration metadata could not be read. This installation may not provide the
                companion read API, or access or the record may have changed. This is not an empty
                declaration.
              </p>
              <Button variant="outline" onClick={() => void declarations.refetch()}>
                Retry declarations
              </Button>
            </div>
          )}
          {data && (
            <>
              <p>
                Deployment <code className="break-all">{data.deployment_id}</code> · Returned scope:{' '}
                <strong>{data.scope}</strong>
              </p>
              {data.state === 'unavailable' ? (
                <p role="alert">
                  Retained declaration metadata is unavailable. The configured helper set could not
                  be verified.
                </p>
              ) : data.companions.length === 0 ? (
                <p>
                  No companions were declared for this deployment. Execution health remains
                  Unverified.
                </p>
              ) : (
                <ul aria-label="Companion declarations" className="space-y-3">
                  {data.companions.map((row) => (
                    <Declaration key={row.name} row={row} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </Panel>
      <Panel
        title="Change companion declarations"
        description="Use the source manifest and reviewed CLI deployment journey."
      >
        <div className="space-y-3 p-4 text-sm">
          <p>
            Declare helpers under <code>companions</code> in <code>gregale.yaml</code>, then review
            and deploy that source with the CLI. Use digest-pinned custom images. Helpers share the
            app lifecycle and loopback network; instance-local scratch disappears on replacement.
          </p>
          <p>
            Built-in presets: opentelemetry, sentry and datadog-dogstatsd. A preset requires an
            operator-qualified image. A preset-unavailable error does not establish that every
            custom helper is unavailable; review a custom digest-pinned image or contact support for
            preset qualification.
          </p>
          <p>
            Update environment grants in the source. This view runs no probes and provides no
            runtime qualification or health guarantee.
          </p>
        </div>
      </Panel>
    </div>
  );
}
