import { Pill } from '@/components/dashboard/resource-table';
import { useCapability } from '@/lib/api/capabilities';

/**
 * The jobs capability's stage, from the registry rather than a fixed word, so
 * the label goes when faas graduates it. Nothing shows until the registry
 * answers, or once the capability is GA.
 */
export function JobsMaturity() {
  const { capability } = useCapability('jobs');
  const label =
    capability?.maturity === 'beta' ? 'Beta' : capability?.maturity === 'preview' ? 'Preview' : '';
  return label ? <Pill label={label} /> : null;
}
