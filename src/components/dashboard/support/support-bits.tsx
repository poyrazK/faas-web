import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { CheckCircle, Clock, MessageText } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import {
  useSupportCapabilities,
  supportError,
  type SupportScope,
  type SupportTicket,
  type useSupportWrite,
} from '@/lib/api/support';
import { capabilityAccess } from '@/lib/capability-state';
import { GATE_MESSAGES } from '../capability-gate';
import { InlinePhase, PageHeader, Panel, queryPhase } from '../primitives';

export function SupportLink({
  org,
  ticket,
  children,
  className,
}: {
  org: string | null;
  ticket?: string;
  children: ReactNode;
  className?: string;
}) {
  if (org)
    return ticket ? (
      <Link
        className={className}
        to="/dashboard/orgs/$org/support/$ticket"
        params={{ org, ticket }}
      >
        {children}
      </Link>
    ) : (
      <Link className={className} to="/dashboard/orgs/$org/support" params={{ org }}>
        {children}
      </Link>
    );
  return ticket ? (
    <Link className={className} to="/dashboard/support/$ticket" params={{ ticket }}>
      {children}
    </Link>
  ) : (
    <Link className={className} to="/dashboard/support" search={{ scope: 'personal' }}>
      {children}
    </Link>
  );
}

export function SupportGate({ scope, children }: { scope: SupportScope; children: ReactNode }) {
  const registry = useSupportCapabilities(scope);
  const phase = registry.data ? 'ready' : registry.isError ? 'error' : 'loading';
  const advertised = registry.data?.capabilities?.some((entry) => entry.key === 'customer-support');
  const access =
    phase === 'ready' && !advertised
      ? 'off'
      : capabilityAccess(registry.data, 'customer-support', phase);
  if (access === 'on') return children;
  return (
    <div className="space-y-5">
      <PageHeader title="Support" />
      <Panel title="Support availability">
        <p role="status" className="text-sm text-muted-foreground">
          {GATE_MESSAGES[access]}
        </p>
        {access === 'registry-error' && (
          <Button variant="outline" className="mt-3" onClick={() => void registry.refetch()}>
            Retry availability
          </Button>
        )}
      </Panel>
    </div>
  );
}

export function SupportStatus({ status }: { status: SupportTicket['status'] }) {
  const state =
    status === 'resolved'
      ? { Icon: CheckCircle, label: 'Resolved', color: 'var(--status-good)' }
      : status === 'pending'
        ? { Icon: Clock, label: 'Waiting for you', color: 'var(--status-warning)' }
        : { Icon: MessageText, label: 'Open', color: 'var(--chart-muted)' };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: state.color }}>
      <state.Icon className="size-3.5" aria-hidden="true" />
      {state.label}
    </span>
  );
}

export function SupportReadState({
  query,
  empty,
}: {
  query: { error: unknown; isPending: boolean; refetch: () => unknown };
  empty?: boolean;
}) {
  const phase = queryPhase({ error: query.error, loading: query.isPending, isEmpty: empty });
  return (
    <InlinePhase
      phase={phase}
      error={query.error ? new Error(supportError(query.error)) : undefined}
      onRetry={() => void query.refetch()}
      emptyMessage="No conversations match these filters."
    />
  );
}

export function SupportWriteError({
  write,
  onSuccess,
}: {
  write: ReturnType<typeof useSupportWrite>;
  onSuccess?: (result: Awaited<ReturnType<typeof write.run>>) => void;
}) {
  if (!write.error) return null;
  return (
    <div className="space-y-3 rounded-lg bg-muted p-3 text-sm" role="alert">
      <p>{supportError(write.error)}</p>
      {!write.conflict && !write.rejected && (
        <p className="text-muted-foreground">
          Delivery is not confirmed. Retry this exact submission before leaving this page to avoid
          sending it twice.
        </p>
      )}
      {write.conflict || write.rejected ? (
        <Button
          type="button"
          variant="outline"
          disabled={write.isPending}
          onClick={() => void write.resetAttempt()}
        >
          {write.conflict ? 'Load latest conversation' : 'Edit request'}
        </Button>
      ) : (
        <Button
          type="button"
          variant="outline"
          disabled={write.isPending}
          onClick={() =>
            void write
              .retry()
              .then((result) => {
                if (result) onSuccess?.(result);
              })
              .catch(() => {})
          }
        >
          {write.isPending ? 'Retrying…' : 'Retry submission'}
        </Button>
      )}
    </div>
  );
}

export const SUPPORT_CATEGORIES = [
  ['deployment', 'Deployments'],
  ['billing', 'Billing'],
  ['account', 'Account'],
  ['incident', 'Something is down'],
  ['other', 'Something else'],
] as const;
export const bytes = (value: string) => new TextEncoder().encode(value).length;
export function supportTextError(value: string, limit: number, label: string) {
  if (!value.trim()) return `Enter ${label.toLowerCase()}.`;
  if (value.includes('\0')) return `${label} contains an unsupported character.`;
  return bytes(value) > limit
    ? `${label} is too long (${bytes(value).toLocaleString()} of ${limit.toLocaleString()} bytes).`
    : undefined;
}
