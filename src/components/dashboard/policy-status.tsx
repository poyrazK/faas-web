import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { errorMessage } from '@/lib/api/errors';
import {
  POLICY_POLL_WINDOW,
  receiptState,
  useRuntimePolicy,
  type PolicyComponent,
  type PolicyReceipt,
  type RuntimePolicy,
} from '@/lib/api/runtime-policy';

const labels: Record<PolicyComponent, string> = {
  request_policy: 'Request policy',
  edge_rules: 'Edge rules',
  cors_presets: 'Account CORS presets',
  response_cache: 'Response cache',
  egress_allowlist: 'Egress allowlist',
  cpu_limit: 'CPU limit',
  scheduler_scaling: 'Scaling policy',
};
export function PolicyStatusView({
  data,
  receipt,
  checkedAt,
  error,
  checking = false,
}: {
  data?: RuntimePolicy;
  receipt: PolicyReceipt;
  checkedAt?: number;
  error?: unknown;
  checking?: boolean;
}) {
  return (
    <div
      className="rounded-lg border border-border bg-muted/20 p-4"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm font-medium">
        {receipt.action === 'purge' ? 'Purge requested' : 'Settings saved'}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Saved intent and observed runtime state are separate.
      </p>
      <ul className="mt-3 divide-y divide-border">
        {receipt.components.map((key) => {
          const state = !error && data ? receiptState(data, receipt, key) : 'unverified';
          const value = !error && data?.app_id === receipt.appId ? data[key] : undefined;
          const label =
            checking && !data
              ? 'Checking'
              : state === 'active'
                ? receipt.action === 'purge'
                  ? 'Applied'
                  : 'Active'
                : state === 'pending'
                  ? 'Pending'
                  : 'Unverified';
          return (
            <li
              key={key}
              data-testid={`policy-${key}`}
              className="flex flex-wrap items-start justify-between gap-2 py-3"
            >
              <div className="min-w-0">
                <p className="text-sm">{labels[key]}</p>
                {value && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Desired revision {value.desired_revision} ·{' '}
                    {value.scope === 'account' ? 'Account' : 'App'} scope
                  </p>
                )}
                {value && 'serving_gateways' in value && (
                  <p className="text-xs text-muted-foreground">
                    {value.applied_gateways}/{value.serving_gateways} serving gateways ·{' '}
                    {value.stale_gateways} stale
                  </p>
                )}
                {value && 'serving_nodes' in value && (
                  <p className="text-xs text-muted-foreground">
                    {value.applied_nodes}/{value.serving_nodes} serving nodes · {value.stale_nodes}{' '}
                    stale
                  </p>
                )}
                {key === 'scheduler_scaling' && (
                  <p className="mt-1 max-w-lg text-xs text-muted-foreground">
                    Policy loaded does not confirm replica count or target capacity.
                  </p>
                )}
                {value && 'observed_at' in value && value.observed_at && (
                  <p className="text-xs text-muted-foreground">
                    Observed {value.observed_at} · revision {value.observed_revision}
                  </p>
                )}
                {receipt.baseline?.[key] === undefined && (
                  <p className="mt-1 max-w-lg text-xs text-muted-foreground">
                    No pre-request revision was available. This request’s application cannot be
                    verified.
                  </p>
                )}
              </div>
              <Badge
                variant="outline"
                className={state === 'active' ? 'border-brand/30 text-brand' : ''}
              >
                {label}
              </Badge>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Could not verify runtime state: {errorMessage(error)}
        </p>
      ) : null}
      {checkedAt ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Checked {new Date(checkedAt).toLocaleTimeString()}
        </p>
      ) : null}
      {receipt.action === 'purge' && (
        <p className="mt-2 max-w-xl text-xs text-muted-foreground">
          Tracks Gregale’s gateway cache and optional shared Redis tier. External caches and CDNs
          are unaffected.
        </p>
      )}
    </div>
  );
}

export function PolicyStatus({
  accountId,
  slug,
  receipt,
}: {
  accountId: string;
  slug: string;
  receipt: PolicyReceipt;
}) {
  const query = useRuntimePolicy(accountId, slug, receipt);
  const [expiredId, setExpiredId] = useState<string>();
  useEffect(() => {
    const timer = setTimeout(
      () => setExpiredId(receipt.id),
      Math.max(0, receipt.acceptedAt + POLICY_POLL_WINDOW - Date.now())
    );
    return () => clearTimeout(timer);
  }, [receipt.id, receipt.acceptedAt]);
  const stopped = expiredId === receipt.id;
  const settled =
    query.data &&
    !query.error &&
    receipt.components.every((key) => receiptState(query.data, receipt, key) === 'active');
  return (
    <div className="mt-4 space-y-2">
      <PolicyStatusView
        data={query.data}
        receipt={receipt}
        checkedAt={query.dataUpdatedAt}
        error={query.error}
        checking={query.isFetching}
      />
      {!settled && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {stopped
              ? 'Automatic checks stopped. Pending state is retained; refresh to check again.'
              : 'Checks run for up to two minutes while this page is visible.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            busy={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh runtime status
          </Button>
        </div>
      )}
    </div>
  );
}
