import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api/errors';
import {
  REVOCATION_WAIT_MS,
  useSecretRevocation,
  type SecretRevocation,
  type SecretRevocationTarget,
} from '@/lib/api/secret-references';
import { cn } from '@/lib/utils';

const instances = (n: number) => `${n} running instance${n === 1 ? '' : 's'}`;

const TONE: Record<SecretRevocation['status'], string> = {
  complete: 'text-[color:var(--status-good)]',
  pending: 'text-muted-foreground',
  blocked: 'text-[color:var(--status-warning)]',
  failed: 'text-[color:var(--status-critical)]',
};
const LABEL: Record<SecretRevocation['status'], string> = {
  complete: 'Removed',
  pending: 'Removing',
  blocked: 'Needs a restart',
  failed: 'Reload failed',
};

/**
 * Plain words for what a deleted secret means to the instances already
 * running with it (faas ADR-339, docs/secrets.md). Only a runtime whose image
 * opted into live reload can drop it in place, and only its own application
 * can confirm that; everything else keeps the value in memory until replaced.
 */
function headline(r: SecretRevocation, expired: boolean) {
  const restartOnly = r.targets.filter(
    (t) => t.status !== 'applied' && t.reload_support !== 'enabled'
  ).length;
  const failed = r.targets.filter((t) => t.status === 'failed').length;
  switch (r.status) {
    case 'complete':
      return r.target_count === 0
        ? `No instance was running with ${r.key}, so nothing held it. The next boot starts without it.`
        : `All ${instances(r.target_count)} confirmed they stopped using ${r.key}.`;
    case 'pending':
      if (expired) {
        const silent = r.targets.filter((t) => t.status === 'pending').length;
        return `No confirmation from ${instances(silent)} in ${REVOCATION_WAIT_MS / 60_000} minutes. An instance that stopped before confirming, or a key that was set again, never confirms, so one may still hold ${r.key} in memory. Restart or redeploy the app to make sure.`;
      }
      return `Waiting for ${r.pending_count} of ${instances(r.target_count)} to confirm. Each one gets a secrets file without ${r.key} and its reload signal within about 10 seconds, then its application confirms.`;
    case 'blocked':
      return `${restartOnly === 1 ? 'One instance' : `${restartOnly} instances`} cannot reload secrets, so ${restartOnly === 1 ? 'it keeps' : 'each keeps'} ${r.key} in memory until it restarts. Restart or redeploy the app to finish removing it.`;
    case 'failed':
      return `${failed === 1 ? 'One instance' : `${failed} instances`} reported that its reload failed, so it may still hold ${r.key} in memory. Restart or redeploy the app to finish removing it.`;
  }
}

function reloadLabel(target: SecretRevocationTarget) {
  if (target.reload_support === 'enabled') return 'live reload';
  return target.reload_support === 'disabled' ? 'restart only' : 'reload unknown';
}

function targetState(target: SecretRevocationTarget, expired: boolean) {
  if (target.status === 'applied') return 'confirmed';
  if (target.status === 'failed') return 'reload failed';
  if (target.reload_support !== 'enabled') return 'until restart';
  return expired ? 'no confirmation' : 'waiting';
}

/**
 * Whether the wait for acknowledgements is over. A pending ack can never
 * arrive once its instance is gone or the key is set again, so the card stops
 * waiting `REVOCATION_WAIT_MS` after the delete, as the poll does.
 */
function useExpired(createdAt: string) {
  const deadline = Date.parse(createdAt) + REVOCATION_WAIT_MS;
  const [expired, setExpired] = useState(() => Date.now() > deadline);
  useEffect(() => {
    if (expired) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, deadline - Date.now()));
    return () => clearTimeout(timer);
  }, [deadline, expired]);
  return expired;
}

/** The delivery status of one secret deletion, watched until it settles. */
export function SecretRevocationStatus({
  slug,
  revocation,
  onDismiss,
}: {
  slug: string;
  revocation: SecretRevocation;
  onDismiss: () => void;
}) {
  const query = useSecretRevocation(slug, revocation);
  const r = query.data;
  const expired = useExpired(r.created_at);
  const label = r.status === 'pending' && expired ? 'No confirmation' : LABEL[r.status];
  return (
    <section
      aria-label={`Removing ${r.key} from running instances`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 text-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            <span className="font-mono text-xs">{r.key}</span> deleted{' '}
            <span
              className={cn(
                'text-xs',
                TONE[r.status === 'pending' && expired ? 'blocked' : r.status]
              )}
            >
              · {label}
            </span>
          </p>
          <p role="status" className="mt-1 text-muted-foreground">
            {headline(r, expired)}
          </p>
          {query.error ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Could not refresh: {errorMessage(query.error)}
            </p>
          ) : null}
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
      {r.targets.length > 0 && (
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {r.targets.map((target) => (
            <li
              key={`${target.instance_id}/${target.workload_name ?? ''}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs [&:not(:first-child)]:pt-2"
            >
              <span className="font-medium">{target.workload_name || 'main'}</span>
              <span className="font-mono text-muted-foreground" title={target.instance_id}>
                {target.instance_id.slice(0, 8)}
              </span>
              <span className="text-muted-foreground">{reloadLabel(target)}</span>
              <span
                className={cn(
                  'ml-auto',
                  target.status === 'applied'
                    ? 'text-[color:var(--status-good)]'
                    : target.status === 'failed'
                      ? 'text-[color:var(--status-critical)]'
                      : 'text-muted-foreground'
                )}
              >
                {targetState(target, expired)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
