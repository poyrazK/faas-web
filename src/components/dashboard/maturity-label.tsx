import { Pill } from '@/components/dashboard/resource-table';
import type { Capability } from '@/lib/api/capabilities';
import { capabilityStage } from '@/lib/capability-state';

/** The stage pill a beta or preview surface carries; the wording is capabilityStage's. */
export function MaturityLabel({ capability }: { capability: Capability | undefined }) {
  const label = capabilityStage(capability?.maturity);
  return label ? <Pill label={label} /> : null;
}
