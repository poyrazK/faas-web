import { useCapabilityAccess } from '@/lib/api/capabilities';
import { SupplyChainPanel } from './supply-chain-panel';

/**
 * Signed deploys are an internal capability (faas catalog `signed-deploys`):
 * capgate answers 404 to PATCH /security for an account it is not released to,
 * so the panel is left out rather than shown as a failure.
 */
export function GatedSupplyChainPanel({ slug }: { slug: string }) {
  const { access } = useCapabilityAccess('signed-deploys');
  return access === 'on' ? <SupplyChainPanel slug={slug} /> : null;
}
