import { useCallback } from 'react';
import { useCapabilityRegistry } from '@/lib/api/capabilities';
import { cn } from '@/lib/utils';
import { capabilityAccess, capabilityStage } from '@/lib/capability-state';

/**
 * Whether apid hides a capability from this account. Nothing is hidden until the
 * registry answers. The function is stable while the registry is, so it can sit
 * in a memo's dependencies.
 */
export function useCapabilityOff(): (id: string) => boolean {
  const { query, phase } = useCapabilityRegistry();
  const data = query.data;
  return useCallback((id: string) => capabilityAccess(data, id, phase) === 'off', [data, phase]);
}

/** A grouped destination has a stage only when its visible features agree. */
export function NavMaturity({
  capabilities,
  className,
}: {
  capabilities: readonly string[];
  className?: string;
}) {
  const { query, phase } = useCapabilityRegistry();
  if (phase !== 'ready' || !query.data) return null;
  const registry = query.data;
  const stages = capabilities
    .filter((id) => !registry.hidden_capabilities?.includes(id))
    .map((id) =>
      capabilityStage(registry.capabilities.find((entry) => entry.key === id)?.maturity)
    );
  const stage = stages[0];
  if (!stage || stages.some((value) => value !== stage)) return null;
  return (
    <span
      className={cn(
        'ml-auto shrink-0 rounded border border-border px-1 text-[10px] leading-4 text-muted-foreground',
        className
      )}
    >
      {stage}
    </span>
  );
}
