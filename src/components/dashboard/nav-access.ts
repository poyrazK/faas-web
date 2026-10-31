import { useCallback } from 'react';
import { useCapabilityRegistry } from '@/lib/api/capabilities';
import { capabilityAccess } from '@/lib/capability-state';

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
