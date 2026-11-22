import { ArrowUpRight } from 'iconoir-react';
import type { EnvironmentState } from '@/lib/api/projects';
import { CopyIconButton } from '@/components/ui/copy-button';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import { publicAppUrl } from '@/lib/app-url';
import { HelpTip } from '../kit/help-tip';
import { Panel } from '../primitives';
import { Disclosure } from '../settings-kit';
import { cn } from '@/lib/utils';
import { releaseWords } from './environment-words';

type Workload = EnvironmentState['workloads'][number];

export function SharedResources({ items }: { items: EnvironmentState['shared_resources'] }) {
  return (
    items.length > 0 && (
      <div className="border-t border-border px-5 py-4 text-sm">
        <h3 className="mb-2 font-medium">Shared resources</h3>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.kind}>
              <span className="font-medium">{item.kind}</span>{' '}
              <span className="text-muted-foreground">({item.ownership})</span>
              <p className="text-muted-foreground">{item.note}</p>
            </li>
          ))}
        </ul>
      </div>
    )
  );
}

/** How many of the environment's apps are live, as a sentence. */
export function liveSentence(workloads: Workload[]): string {
  // The panel below says so; the sentence does not say it twice.
  if (!workloads.length) return '';
  const live = workloads.filter((workload) => workload.release.status === 'live').length;
  if (live === workloads.length)
    return workloads.length === 1 ? 'Its app is live.' : `All ${live} apps are live.`;
  if (live === 0)
    return workloads.length === 1 ? 'Its app is not deployed.' : 'None of its apps is deployed.';
  return `${live} of ${workloads.length} apps are live.`;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm">{children}</dd>
    </div>
  );
}

/** One app in the environment: is it live, a way to open it, the rest on request. */
function WorkloadRow({ workload }: { workload: Workload }) {
  const { release } = workload;
  const live = release.status === 'live';
  const url = publicAppUrl(release.url);
  return (
    <li className="flex flex-col gap-3 px-5 py-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={
            live
              ? { backgroundColor: 'var(--status-good)' }
              : { boxShadow: 'inset 0 0 0 1.5px var(--chart-muted)' }
          }
        />
        <h3 className="min-w-0 truncate text-[15px] font-medium">{workload.workload_name}</h3>
        <span className={cn('text-sm text-muted-foreground', live && 'font-mono text-xs')}>
          {releaseWords(release)}
        </span>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="pressable ml-auto inline-flex h-8 items-center gap-1 rounded-full bg-muted px-3 text-[13px] text-foreground"
          >
            Open app
            <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </li>
  );
}

/** One app's ids, variables, secret metadata and bindings, for "Technical details". */
function WorkloadFacts({ workload }: { workload: Workload }) {
  const { release } = workload;
  const artifact = release.image_digest || release.source_sha256 || release.commit_sha;
  return (
    <section aria-label={`${workload.workload_name} details`} className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{workload.workload_name}</h3>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Fact label="Deployment">
          {release.deployment_id ? (
            <CopyableId value={release.deployment_id} label="deployment ID" />
          ) : (
            'Not deployed'
          )}
        </Fact>
        <Fact label="Built from">
          {artifact ? <CopyableId value={artifact} label="artifact" /> : 'Unknown'}
        </Fact>
        <Fact label="Routes">
          {workload.routes.declared_routes.length} declared, owned by {workload.routes.ownership}
        </Fact>
        <Fact label="Headers and CORS">
          {workload.policies.rules.length} rules, owned by {workload.policies.ownership}
        </Fact>
        {workload.domains.length > 0 && (
          <Fact label="Domains">
            <span className="break-all">
              {workload.domains
                .map(
                  (domain) => `${domain.domain} (${domain.verified ? 'verified' : 'unverified'})`
                )
                .join(', ')}
            </span>
          </Fact>
        )}
      </dl>
      <div>
        <h4 className="text-xs text-muted-foreground">Variables ({workload.variables.length})</h4>
        {workload.variables.length > 0 && (
          <dl className="mt-1.5 space-y-1.5 text-sm">
            {workload.variables.map((variable) => (
              <div key={variable.key} className="flex flex-wrap gap-x-2">
                <dt className="text-xs leading-5">
                  <CopyableId value={variable.key} label="variable name" full />
                </dt>
                <dd className="min-w-0 break-all whitespace-pre-wrap font-mono text-xs leading-5 text-muted-foreground">
                  <span>{variable.value}</span>
                  <CopyIconButton text={variable.value} label={'value of ' + variable.key} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div>
        <h4 className="flex items-center gap-1 text-xs text-muted-foreground">
          Secrets ({workload.secrets.length})
          <HelpTip label="About secrets here">
            Values and sealing details are never shown. The fingerprint changes when the value does.
          </HelpTip>
        </h4>
        {workload.secrets.length > 0 && (
          <ul className="mt-1.5 space-y-1.5 text-sm">
            {workload.secrets.map((secret) => (
              <li key={secret.key} className="break-all">
                <CopyableId value={secret.key} label="secret name" full />{' '}
                <span className="text-xs text-muted-foreground">
                  fingerprint{' '}
                  {secret.value_hash ? (
                    <CopyableId value={secret.value_hash} label="secret fingerprint" />
                  ) : (
                    'unknown'
                  )}
                  , version {secret.version ?? 'unknown'}
                  {secret.managed_by && `, managed by ${secret.managed_by}`}
                  {secret.binding_id && (
                    <>
                      , binding <CopyableId value={secret.binding_id} label="binding ID" />
                    </>
                  )}
                  {secret.credential_generation !== undefined &&
                    `, generation ${secret.credential_generation}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {workload.bindings.length > 0 && (
        <div>
          <h4 className="text-xs text-muted-foreground">
            Managed bindings ({workload.bindings.length})
          </h4>
          <ul className="mt-1.5 space-y-1.5 text-sm">
            {workload.bindings.map((binding) => (
              <li key={binding.binding_id} className="break-all">
                {binding.kind}{' '}
                <span className="text-xs text-muted-foreground">
                  <CopyableId value={binding.binding_id} label="binding ID" />, generation{' '}
                  {binding.credential_generation ?? 'unknown'}, keys{' '}
                  {binding.secret_keys.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * What an environment runs right now: one line per app — live with its short
 * release, or not deployed — with a way to open it. Every id, digest, variable,
 * secret fingerprint, the configuration and the release set sit behind one
 * "Technical details" for the whole environment.
 */
export function EnvironmentStateView({ data }: { data: EnvironmentState }) {
  const set = data.active_release_set;
  return (
    <Panel
      title={`Running in ${data.environment}`}
      padded={false}
      actions={
        <span className="text-xs text-muted-foreground">
          Read <Timestamp value={data.generated_at} />
        </span>
      }
    >
      {!data.workloads.length ? (
        <p className="px-5 pb-5 text-sm text-muted-foreground">No apps in this environment.</p>
      ) : (
        <ul
          aria-label={`Apps in ${data.environment}`}
          className="divide-y divide-border border-t border-border"
        >
          {data.workloads.map((workload) => (
            <WorkloadRow key={workload.workload_slug} workload={workload} />
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-4 border-t border-border px-5 py-4 text-sm">
        <div className="flex flex-col gap-2">
          <p>
            Configuration version {data.configuration.version}
            <span className="text-muted-foreground">
              {' · '}
              {set
                ? `release set ${data.release_set_status ?? 'status unknown'}`
                : data.release_set_status === 'none'
                  ? 'no release set active'
                  : 'release set unavailable'}
            </span>
          </p>
          <Disclosure label="Technical details">
            {data.workloads.map((workload) => (
              <WorkloadFacts key={workload.workload_slug} workload={workload} />
            ))}
            <div>
              <h3 className="text-xs text-muted-foreground">Configuration values</h3>
              <pre className="well mt-1.5 max-h-64 overflow-auto rounded-xl bg-muted/40 p-3 text-xs">
                {JSON.stringify(data.configuration.values, null, 2)}
              </pre>
              <p className="mt-2 break-all text-xs text-muted-foreground">
                Fingerprint: {data.configuration.config_hash}
              </p>
            </div>
            <div>
              <h3 className="flex items-center gap-1 text-xs text-muted-foreground">
                Release set
                <HelpTip label="About release sets">
                  A release set (release graph) records which deployment of each app was released
                  together. Its members can differ from each app&apos;s live release.
                </HelpTip>
              </h3>
              {set ? (
                <div className="mt-1.5 space-y-1.5">
                  <CopyableId value={set.id} label="release set ID" />
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {set.members.map((member) => (
                      <li key={member.app_id} className="break-all">
                        App {member.app_id}: deployment {member.deployment_id}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-1.5 text-muted-foreground">
                  {data.release_set_status === 'none'
                    ? 'No release set is active.'
                    : 'The release set could not be read.'}
                </p>
              )}
            </div>
          </Disclosure>
        </div>
      </div>
      <SharedResources items={data.shared_resources} />
    </Panel>
  );
}
