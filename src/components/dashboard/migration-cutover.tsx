import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Panel } from './primitives';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/errors';
import {
  actOnMigrationCutover,
  connectMigrationDomain,
  createMigrationCutover,
  listMigrationCutovers,
  type MigrationCutover as Cutover,
  type MigrationCutoverAction,
  type MigrationCutoverRequest,
} from '@/lib/api/migration-cutover';
import type { MigrationVerification } from '@/lib/api/migration-verification';

const FIELD = 'rounded-md border border-border bg-background px-3 py-2 text-sm';
const STATUS: Record<Cutover['status'], string> = {
  prepared: 'Production switch prepared — traffic is unchanged',
  checking: 'Checking the production hostname',
  ready: 'Production hostname checks passed',
  attention: 'Cutover checks need attention',
  completed: 'Production switch completed',
  cancelled: 'Cutover checks cancelled',
  restored: 'Previous provider restored — confirmed by you',
  blocked: 'Saved checks no longer apply to the current setup',
};
const REASON: Record<string, string> = {
  deployment_or_configuration_changed:
    'The deployment or configuration changed. Verify the current deployment and prepare a new plan. Your previous DNS settings are still available below.',
  domain_binding_changed:
    'This hostname was removed, replaced or connected to a different app or environment. Prepare a new plan for the correct binding.',
  verification_unavailable:
    'The original verification is no longer available. Verify the current deployment before preparing a new switch.',
  check_deadline_reached:
    'The thirty-minute checking window ended. Review DNS propagation, domain ownership and TLS, then restart checks.',
  waiting_for_dns_tls_or_route:
    'Waiting for DNS, domain verification and the selected deployment to answer over HTTPS. DNS caches may still return the previous provider.',
};

function DNSRecords({ plan, previous = false }: { plan: Cutover; previous?: boolean }) {
  const records = previous
    ? plan.request.previous_records.map((record) => ({ ...record, name: plan.request.hostname }))
    : plan.dns_records;
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full text-left text-xs"
        aria-label={previous ? 'Previous DNS records' : 'Gregale DNS records'}
      >
        <thead>
          <tr>
            <th className="p-2">Type</th>
            <th className="p-2">Name</th>
            <th className="p-2">Value</th>
            <th className="p-2">{previous ? 'TTL (seconds)' : 'Purpose'}</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, i) => (
            <tr key={i} className="border-t border-border">
              <td className="p-2 font-mono">{record.type}</td>
              <td className="p-2 font-mono">{record.name}</td>
              <td className="break-all p-2 font-mono">{record.value}</td>
              <td className="p-2">
                {'ttl' in record
                  ? record.ttl
                  : `${record.purpose}${record.alternative ? ' (alternative)' : ''}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MigrationCutover({
  app,
  deployment,
  verification,
}: {
  app: string;
  deployment: string;
  verification?: MigrationVerification;
}) {
  const qc = useQueryClient();
  const key = ['migration-cutovers', app] as const;
  const plans = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => listMigrationCutovers(app, signal),
    retry: false,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.plans.some((plan) => plan.status === 'checking' || plan.status === 'ready')
        ? 2500
        : false,
  });
  const [selected, setSelected] = useState<string>();
  const [newPlan, setNewPlan] = useState(false);
  const [hostname, setHostname] = useState('');
  const [records, setRecords] = useState('');
  const [proxy, setProxy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorPercent, setErrorPercent] = useState('1');
  const [p95, setP95] = useState('1000');
  const [limited, setLimited] = useState<string>();
  const [restored, setRestored] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef<MigrationCutoverRequest | undefined>(undefined);
  const submitting = useRef(false);
  const plan = plans.data?.plans.find((item) => item.id === selected) ?? plans.data?.plans[0];
  const eligible =
    verification?.status === 'passed' &&
    verification.deployment_id === deployment &&
    verification.scope === 'default';
  const terminal = plan && ['completed', 'cancelled', 'restored', 'blocked'].includes(plan.status);

  function save(next: Cutover) {
    qc.setQueryData(key, (old: { plans: Cutover[] } | undefined) => ({
      plans: [next, ...(old?.plans ?? []).filter((item) => item.id !== next.id)],
    }));
    setSelected(next.id);
  }
  async function reload() {
    const result = await plans.refetch();
    if (
      !result.isError &&
      pending.current &&
      result.data?.plans.some((item) => item.id === pending.current?.id)
    ) {
      setSelected(pending.current.id);
      pending.current = undefined;
      setUncertain(false);
      setNewPlan(false);
    }
    if (!result.isError && !pending.current) setError(undefined);
    return result;
  }
  async function prepare() {
    if (submitting.current || !verification) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      if (!pending.current) {
        const previous = records
          .trim()
          .split('\n')
          .map((line) => {
            const [type, value, ttl, ...extra] = line.trim().split(/\s+/);
            if (
              !['A', 'AAAA', 'CNAME'].includes(type) ||
              !value ||
              !ttl ||
              extra.length ||
              !/^\d+$/.test(ttl)
            )
              throw new Error(
                'Use one routing record per line: TYPE VALUE TTL, for example CNAME old.provider.com 300.'
              );
            const seconds = Number(ttl);
            if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > 2147483647)
              throw new Error('Each DNS TTL must be a whole number from 0 to 2147483647 seconds.');
            return { type: type as 'A' | 'AAAA' | 'CNAME', value, ttl: seconds };
          });
        pending.current = {
          id: crypto.randomUUID(),
          verification_id: verification.id,
          hostname: hostname.trim().toLowerCase(),
          previous_records: previous,
          previous_proxy_enabled: proxy,
          max_5xx_rate_bps: Math.round(Number(errorPercent) * 100),
          max_p95_ms: Number(p95),
        };
      }
      save(await createMigrationCutover(app, pending.current));
      pending.current = undefined;
      setUncertain(false);
      setNewPlan(false);
    } catch (err) {
      if (!pending.current || (err instanceof ApiError && err.code === 'validation_failed')) {
        pending.current = undefined;
        setError(
          err instanceof Error ? err.message : 'Review the hostname and previous DNS records.'
        );
      } else {
        setUncertain(true);
        setError(
          'Could not confirm that this plan was saved. Reload plans or retry saving the same plan.'
        );
        await reload();
      }
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function action(action: MigrationCutoverAction['action']) {
    if (!plan || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      save(
        await actOnMigrationCutover(app, plan.id, {
          action,
          acknowledge_limited_traffic: action === 'complete' && limited === plan.id,
        })
      );
      setLimited(undefined);
      setRestored(undefined);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'validation_failed'
          ? err.message
          : 'Could not confirm this action. Reload the saved plan before continuing.'
      );
      void plans.refetch();
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function connect() {
    if (!plan || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await connectMigrationDomain(app, plan.request.hostname);
      await plans.refetch();
    } catch (err) {
      const recovered = await plans.refetch();
      if (!recovered.data?.plans.find((item) => item.id === plan.id)?.domain_connected)
        setError(
          err instanceof ApiError
            ? err.message
            : 'Could not confirm domain setup. Reload this plan before trying again.'
        );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (!eligible && !plans.data?.plans.length) return null;
  return (
    <Panel
      title="Switch production traffic"
      description="Save a recovery plan, connect your production hostname, then check the switch to Gregale."
    >
      {plans.isPending ? (
        <p role="status">Loading saved cutover plans…</p>
      ) : plans.isError && !plans.data ? (
        <p role="alert">
          Saved cutover plans could not be loaded. Reload them before preparing a switch.
        </p>
      ) : (
        <>
          {plan && (
            <div className="space-y-4" aria-label="Production cutover plan">
              {(plans.data?.plans.length ?? 0) > 1 && (
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono">Saved production plans</span>
                  <select
                    className={FIELD}
                    aria-label="Saved production plans"
                    value={plan.id}
                    onChange={(event) => {
                      setSelected(event.target.value);
                      setLimited(undefined);
                      setRestored(undefined);
                      setError(undefined);
                    }}
                  >
                    {plans.data?.plans.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.request.hostname} · {new Date(item.created_at).toLocaleString()} ·{' '}
                        {item.status}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p role="status" className="font-medium">
                {STATUS[plan.status]}
              </p>
              <p className="text-sm">
                <span className="font-mono">{plan.request.hostname}</span> → deployment{' '}
                <span className="font-mono">{plan.deployment_id}</span>
              </p>
              {plan.reason && (
                <p className="text-sm" role="alert">
                  {REASON[plan.reason] ??
                    'Review the saved checks and domain diagnostics before continuing.'}
                </p>
              )}
              {plan.status === 'prepared' && !plan.domain_connected && (
                <Button busy={busy} disabled={busy} onClick={() => void connect()}>
                  Add this domain to Gregale
                </Button>
              )}
              {plan.domain_connected && !terminal && (
                <div className="space-y-2">
                  <p className="text-sm">
                    Publish the TXT ownership record first. When ready to switch traffic, replace
                    the previous routing with the CNAME below, or use the A/AAAA alternatives if
                    your DNS provider requires them. Choose one routing method. Use DNS only; turn
                    off the CDN proxy for this hostname.
                  </p>
                  <DNSRecords plan={plan} />
                  <p className="text-xs text-muted-foreground">
                    Consider lowering the old routing TTL in advance and waiting for its previous
                    TTL to pass. Keep the old service available while DNS caches update. TLS may
                    take a few minutes after routing reaches Gregale.
                  </p>
                </div>
              )}
              {plan.checks.length > 0 && (
                <ul className="space-y-2 text-sm">
                  {plan.checks.map((check) => (
                    <li key={check.name}>
                      <span className="font-medium">
                        {(
                          {
                            ownership: 'Domain ownership',
                            dns_routing: 'DNS routing',
                            tls: 'HTTPS certificate',
                            deployment_route: 'Selected deployment',
                          } as Record<string, string>
                        )[check.name] ?? 'Cutover check'}
                        : {check.status}
                      </span>
                      <p className="text-muted-foreground">{check.detail}</p>
                    </li>
                  ))}
                </ul>
              )}
              {(plan.status === 'prepared' || plan.status === 'attention') &&
                plan.domain_connected && (
                  <Button busy={busy} disabled={busy} onClick={() => void action('start_checks')}>
                    {plan.status === 'attention'
                      ? 'Restart cutover checks'
                      : 'I updated DNS — start checks'}
                  </Button>
                )}
              {(plan.status === 'checking' || plan.status === 'ready') && (
                <p className="text-sm text-muted-foreground">
                  Checks continue on the server for up to thirty minutes. You can close this page
                  and return.
                </p>
              )}
              {plan.hostname_verified_at && (
                <div className="space-y-2 rounded-md border border-border p-3 text-sm">
                  <p className="font-medium">
                    Traffic health:{' '}
                    {plan.traffic.status === 'healthy'
                      ? 'within selected budgets'
                      : plan.traffic.status === 'violated'
                        ? 'sustained budget violation'
                        : 'limited evidence'}
                  </p>
                  <p>
                    Observed GET {plan.smoke_path}: {plan.traffic.requests.toLocaleString()}{' '}
                    requests, {plan.traffic.server_errors.toLocaleString()} server errors
                    {plan.traffic.worst_window_p95_ms != null
                      ? `, worst observed window p95 ${Math.round(plan.traffic.worst_window_p95_ms)} ms`
                      : ''}
                    .
                  </p>
                  <p className="text-muted-foreground">
                    Budgets: {plan.request.max_5xx_rate_bps / 100}% server errors and{' '}
                    {plan.request.max_p95_ms} ms p95. Only observed requests to this deployment and
                    exact route after hostname verification count. These aggregates are not specific
                    to the hostname and cannot prove that every customer has moved. Missing or
                    sparse traffic is unknown.
                  </p>
                  {plan.status === 'ready' && plan.traffic.status === 'unknown' && (
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={limited === plan.id}
                        onChange={(event) => setLimited(event.target.checked ? plan.id : undefined)}
                      />
                      <span>
                        I acknowledge the limited traffic evidence and will continue monitoring
                        production.
                      </span>
                    </label>
                  )}
                  {plan.limited_traffic_acknowledged && (
                    <p>Completed with your acknowledgement of limited traffic evidence.</p>
                  )}
                  {plan.traffic.status === 'violated' && (
                    <p role="alert">
                      Review errors and latency before completing the switch. Use the recovery
                      settings below if you need to return to your previous provider.
                    </p>
                  )}
                </div>
              )}
              {plan.status === 'ready' && (
                <Button
                  busy={busy}
                  disabled={
                    busy ||
                    plan.traffic.status === 'violated' ||
                    (plan.traffic.status !== 'healthy' && limited !== plan.id)
                  }
                  onClick={() => void action('complete')}
                >
                  Complete production switch
                </Button>
              )}
              {plan.checked_at && (
                <p className="text-xs text-muted-foreground">
                  Last checked {new Date(plan.checked_at).toLocaleString()}. Completion checks the
                  hostname again.
                </p>
              )}
              <div className="flex flex-wrap gap-3 text-sm">
                <Link to="/dashboard/domains" className="text-brand underline">
                  Domain diagnostics
                </Link>
                <a
                  className="text-brand underline"
                  download={`cutover-${plan.id}.json`}
                  href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(plan, null, 2))}`}
                >
                  Download cutover plan
                </a>
              </div>
              <details
                className="rounded-md border border-border p-3"
                open={
                  plan.status === 'attention' ||
                  plan.status === 'blocked' ||
                  plan.traffic.status === 'violated' ||
                  plan.status === 'restored'
                }
              >
                <summary className="cursor-pointer text-sm font-medium">
                  Restore previous provider
                </summary>
                <div className="mt-3 space-y-3 text-sm">
                  <p>
                    At your DNS provider, remove Gregale routing for{' '}
                    <strong>{plan.request.hostname}</strong> and restore every routing record below,
                    including IPv6. Restore the recorded TTLs and set the DNS provider’s CDN proxy
                    to{' '}
                    <strong>
                      {plan.request.previous_proxy_enabled ? 'enabled' : 'disabled (DNS only)'}
                    </strong>
                    . Leave other DNS records in place.
                  </p>
                  <DNSRecords plan={plan} previous />
                  <p>
                    These are the settings you saved before the switch. Gregale does not edit
                    provider DNS. Check the previous service directly and wait for cached DNS
                    records to expire before retiring either service.
                  </p>
                  {plan.status !== 'restored' && (
                    <>
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={restored === plan.id}
                          onChange={(event) =>
                            setRestored(event.target.checked ? plan.id : undefined)
                          }
                        />
                        <span>
                          I restored the previous DNS settings and checked the previous service.
                        </span>
                      </label>
                      <Button
                        variant="outline"
                        disabled={busy || restored !== plan.id}
                        busy={busy}
                        onClick={() => void action('confirm_restored')}
                      >
                        Record that I restored the previous provider
                      </Button>
                    </>
                  )}
                </div>
              </details>
              {!['completed', 'cancelled', 'restored'].includes(plan.status) && (
                <Button variant="outline" disabled={busy} onClick={() => void action('cancel')}>
                  Cancel cutover checks
                </Button>
              )}
              {terminal && eligible && !newPlan && (
                <Button variant="outline" onClick={() => setNewPlan(true)}>
                  Prepare another switch
                </Button>
              )}
            </div>
          )}
          {eligible && (!plan || newPlan || uncertain) && (
            <fieldset disabled={busy || uncertain} className="mt-4 space-y-4">
              <legend className="sr-only">Prepare a production switch</legend>
              <p className="text-sm text-muted-foreground">
                Preparing saves instructions and leaves traffic unchanged. Copy the old DNS settings
                from your DNS provider before editing them.
              </p>
              <label className="flex flex-col gap-1.5">
                <span className="label-mono">Production hostname</span>
                <input
                  aria-label="Production hostname"
                  className={FIELD}
                  placeholder="api.example.com"
                  value={hostname}
                  onChange={(event) => setHostname(event.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="label-mono">Previous provider routing records</span>
                <textarea
                  aria-label="Previous provider routing records"
                  className={FIELD + ' font-mono'}
                  rows={3}
                  placeholder={'CNAME old.provider.com 300\nor A 203.0.113.10 300'}
                  value={records}
                  onChange={(event) => setRecords(event.target.value)}
                />
                <span className="text-xs text-muted-foreground">
                  One record per line: TYPE VALUE TTL in seconds. Use CNAME, A or AAAA. Save every
                  current address, including IPv6. Do not enter credentials.
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={proxy}
                  onChange={(event) => setProxy(event.target.checked)}
                />
                <span>The DNS provider’s CDN proxy is currently enabled.</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={copied}
                  onChange={(event) => setCopied(event.target.checked)}
                />
                <span>I copied all current routing records and TTLs for this hostname.</span>
              </label>
              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono">Maximum server errors (%)</span>
                  <input
                    className={FIELD}
                    aria-label="Maximum server errors (%)"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={errorPercent}
                    onChange={(event) => setErrorPercent(event.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono">Maximum p95 latency (ms)</span>
                  <input
                    className={FIELD}
                    aria-label="Maximum p95 latency (ms)"
                    type="number"
                    min="1"
                    max="86400000"
                    value={p95}
                    onChange={(event) => setP95(event.target.value)}
                  />
                </label>
              </div>
              <Button
                busy={busy}
                disabled={
                  busy ||
                  !copied ||
                  !hostname.trim() ||
                  !records.trim() ||
                  !p95 ||
                  !errorPercent ||
                  !Number.isFinite(Number(p95)) ||
                  !Number.isFinite(Number(errorPercent))
                }
                onClick={() => void prepare()}
              >
                Prepare production switch
              </Button>
            </fieldset>
          )}
        </>
      )}
      {uncertain && (
        <Button className="mt-3" disabled={busy} onClick={() => void prepare()}>
          Retry saving this plan
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm">
          {error}
        </p>
      )}
      {plans.isError && plans.data && (
        <p role="alert" className="mt-3 text-sm">
          The saved plan could not refresh. Keep a copy of its recovery settings while reconnecting.
        </p>
      )}
      {(plans.isError || error || uncertain) && (
        <Button className="mt-3" variant="outline" onClick={() => void reload()}>
          Reload cutover plans
        </Button>
      )}
    </Panel>
  );
}
