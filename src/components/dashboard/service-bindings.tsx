import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useCapability } from '@/lib/api/capabilities';
import { useApp } from '@/lib/api/queries';
import { useAppPolicyOwnership, useBindingInventory } from '@/lib/api/bindings';
import { Button } from '@/components/ui/button';
import { CapabilityNotice } from './capability-notice';
import { Panel } from './primitives';
import { ServicePolicyEditor } from './service-policy-editor';

export function ServiceBindings({ slug }: { slug: string }) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const capability = useCapability('internal-services');
  const app = useApp(slug, { enabled: Boolean(accountId) }, accountId);
  const inventory = useBindingInventory(accountId, slug);
  const ownership = useAppPolicyOwnership(accountId, slug);
  const [copyFailure, setCopyFailure] = useState('');
  const available = capability.accountId === accountId && capability.state === 'available';
  const data = app.data;
  const serviceRows = inventory.data?.bindings.filter((item) => item.type === 'service') ?? [];

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyFailure('');
    } catch {
      setCopyFailure('Clipboard access failed. Select and copy the address manually.');
    }
  }

  return (
    <div className="space-y-5">
      <Panel
        title="Internal services"
        description="Declared bindings and caller policies. Verification is a separate platform observation."
      >
        <div className="space-y-4 p-4 text-sm">
          <CapabilityNotice
            capability={capability.capability}
            state={capability.state}
            onRetry={capability.refresh}
          />
          {!available && (
            <p>Service changes are unavailable until capability access is confirmed.</p>
          )}
          {app.isPending ? (
            <p role="status">Loading app service policy…</p>
          ) : app.error ? (
            <p role="alert">
              Could not read app policy.{' '}
              <Button variant="outline" onClick={() => void app.refetch()}>
                Retry
              </Button>
            </p>
          ) : data ? (
            <div className="space-y-2">
              <p>
                Visibility: <strong>{data.visibility ?? 'public'}</strong>. Internal routing
                requires an authenticated same-account service caller; this is separate from public
                URL authentication.
              </p>
              <p>
                Outbound policy: <strong>{data.service_binding_policy ?? 'account'}</strong>.
                Canonical binding transport:{' '}
                <strong>{data.service_binding_transport ?? 'http'}</strong>.
              </p>
              <p>
                Target caller policy:{' '}
                {data.allowed_service_callers === undefined
                  ? 'Any authenticated same-account caller may be considered.'
                  : data.allowed_service_callers.length === 0
                    ? 'No internal callers are allowed.'
                    : `Allowed callers: ${data.allowed_service_callers.join(', ')}.`}
              </p>
              {data.allowed_service_call_scopes && (
                <div>
                  <p>Method and path grants further limit each named caller:</p>
                  <ul className="list-disc pl-5">
                    {Object.entries(data.allowed_service_call_scopes).map(([caller, scope]) => (
                      <li key={caller} className="break-all">
                        {caller}: {scope.methods.join(', ')} on {scope.path_prefixes.join(', ')}
                      </li>
                    ))}
                  </ul>
                  {Object.keys(data.allowed_service_call_scopes).length === 0 && (
                    <p>No callers have method and path grants.</p>
                  )}
                </div>
              )}
              {data.preview_of_slug ? (
                <p>
                  Preview service policies inherit from {data.preview_of_slug}. Edit the project
                  source.
                </p>
              ) : ownership.isPending ? (
                <p>Checking source ownership before allowing policy edits…</p>
              ) : ownership.error || ownership.data?.kind === 'unverified' ? (
                <p role="alert">
                  Source ownership could not be confirmed. Edit policies with the CLI or manifest
                  after checking the source.
                </p>
              ) : ownership.data?.kind === 'project' ? (
                <p>
                  Project {ownership.data.projectSlug} owns these service policies. Edit depends_on
                  and x-gregale-service-* or x-gregale-allow-callers in its manifest, then apply the
                  project source.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Panel>

      {available &&
        account &&
        data &&
        !data.preview_of_slug &&
        ownership.data?.kind === 'standalone' &&
        !ownership.isFetching &&
        !ownership.error && (
          <ServicePolicyEditor
            key={`${accountId}:${data.id}`}
            accountId={accountId}
            plan={account.plan}
            slug={slug}
            app={data}
            inventoryComplete={inventory.data?.complete === true}
            verifiedServices={serviceRows
              .filter((row) => row.verification_status === 'passed')
              .map((row) => row.name)}
          />
        )}

      <Panel
        title="Binding inventory"
        description="Read-only configuration and independent evidence, collected without a workload probe."
      >
        <div className="space-y-3 p-4 text-sm">
          {inventory.isPending ? (
            <p role="status">Loading binding inventory…</p>
          ) : inventory.error ? (
            <p role="alert">
              Could not read binding inventory.{' '}
              <Button variant="outline" onClick={() => void inventory.refetch()}>
                Retry
              </Button>
            </p>
          ) : inventory.data ? (
            <>
              <p>
                Inventory collected {new Date(inventory.data.generated_at).toLocaleString()}.{' '}
                {inventory.data.complete
                  ? 'All inventory sections were read.'
                  : 'Inventory is partial; some resource sections could not be read.'}
              </p>
              {inventory.data.issues?.map((issue) => (
                <p
                  key={`${issue.type}:${issue.code}`}
                  role={issue.severity === 'error' ? 'alert' : 'status'}
                >
                  {issue.message}
                </p>
              ))}
              {serviceRows.length ? (
                <ul className="divide-y divide-border rounded border border-border">
                  {serviceRows.map((row) => (
                    <li key={`${row.name}:${row.binding}`} className="space-y-2 p-3">
                      <p className="font-medium">
                        {row.name} · {row.binding}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Declared state: {row.state} · Access: {row.access} · Runtime observation:{' '}
                        {row.runtime_status} · Canary {row.verification_status}
                      </p>
                      {row.verification && (
                        <p className="text-xs text-muted-foreground">
                          Canary {row.verification.result} for deployment{' '}
                          {row.verification.deployment_id} ·{' '}
                          {row.verification.reason ?? 'No reason reported'}
                        </p>
                      )}
                      {[row.http_url, row.https_url]
                        .filter((value): value is string => Boolean(value))
                        .map((address) => (
                          <div key={address} className="flex min-w-0 items-center gap-2">
                            <input
                              readOnly
                              aria-label={`${row.name} internal address`}
                              value={address}
                              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-xs"
                            />
                            <Button variant="outline" onClick={() => void copy(address)}>
                              Copy
                            </Button>
                          </div>
                        ))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No service bindings are declared in the returned inventory.</p>
              )}
              {copyFailure && <p role="alert">{copyFailure}</p>}
            </>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
