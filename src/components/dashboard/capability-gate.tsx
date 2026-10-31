import type { ComponentType, ReactNode } from 'react';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import type { CapabilityAccess } from '@/lib/capability-state';
import { Panel } from './primitives';

/** Same wording as CAPABILITY_LABELS, so every gate reads alike. */
const MESSAGES: Record<Exclude<CapabilityAccess, 'on'>, string> = {
  loading: 'Checking availability…',
  off: 'Not enabled for this account',
  'plan-not-entitled': 'Not included in your plan',
  'runtime-unavailable': 'Unavailable on this installation',
  'registry-error': 'Availability could not be checked',
};

/**
 * Renders `children` only when the account has the capability. Children mount,
 * and their queries run, only past the gate, so an unreleased feature never
 * calls a route apid answers with 404 (faas capgate, #5319).
 */
export function CapabilityGate({
  capability,
  title,
  children,
}: {
  capability: string;
  title: string;
  children: ReactNode;
}) {
  const { access, refresh } = useCapabilityAccess(capability);
  if (access === 'on') return <>{children}</>;
  return (
    <Panel title={title}>
      <div
        role="status"
        className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
      >
        <span>{MESSAGES[access]}</span>
        {access === 'off' && (
          <a className="text-brand underline" href="/dashboard/settings?section=previews">
            See previews you can join
          </a>
        )}
        {access === 'plan-not-entitled' && (
          <a className="text-brand underline" href="/dashboard/plans">
            View plans
          </a>
        )}
        {access === 'registry-error' && (
          <button type="button" className="text-brand underline" onClick={refresh}>
            Retry
          </button>
        )}
      </div>
    </Panel>
  );
}

/**
 * A route component behind its capability, so a bookmarked URL to a page the
 * nav hides explains itself instead of calling routes apid answers with 404.
 */
export function withCapability<P extends object>(
  capability: string,
  title: string,
  Page: ComponentType<P>
) {
  function Gated(props: P) {
    return (
      <CapabilityGate capability={capability} title={title}>
        <Page {...props} />
      </CapabilityGate>
    );
  }
  Gated.displayName = `withCapability(${capability})`;
  return Gated;
}
