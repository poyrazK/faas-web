import { Button } from '@/components/ui/button';
import { CAPABILITY_LABELS, type CapabilityViewState } from '@/lib/capability-state';
import { safeCapabilityDocs } from '@/lib/capability-entrypoints';
import type { Capability } from '@/lib/api/capabilities';

export function CapabilityNotice({
  capability,
  state,
  onRetry,
}: {
  capability?: Capability;
  state: CapabilityViewState;
  onRetry?: () => void;
}) {
  const docs = capability && safeCapabilityDocs(capability.docs_url);
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground">
        {capability?.maturity === 'preview'
          ? 'Preview · '
          : capability?.maturity === 'beta'
            ? 'Beta · '
            : ''}
        {CAPABILITY_LABELS[state]}
      </span>
      {state === 'runtime-unavailable' && (
        <span className="text-xs text-muted-foreground">Contact support for availability.</span>
      )}
      {state === 'plan-not-entitled' && (
        <a className="text-brand underline" href="/dashboard/plans">
          View plans
        </a>
      )}
      {(state === 'registry-error' || state === 'unknown') && onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry capabilities
        </Button>
      )}
      {docs && (
        <a className="text-brand underline" href={docs}>
          Documentation
        </a>
      )}
    </div>
  );
}
