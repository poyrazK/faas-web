import { Pill } from '@/components/dashboard/resource-table';
import type { Capability } from '@/lib/api/capabilities';

/** "Beta" or "Preview" from the registry; nothing when it does not say. */
export function maturityLabel(capability: Capability | undefined): string {
  if (capability?.maturity === 'beta') return 'Beta';
  if (capability?.maturity === 'preview') return 'Preview';
  return '';
}

/** The stage pill a beta or preview surface carries, worded as CapabilityNotice words it. */
export function MaturityLabel({ capability }: { capability: Capability | undefined }) {
  const label = maturityLabel(capability);
  return label ? <Pill label={label} /> : null;
}
