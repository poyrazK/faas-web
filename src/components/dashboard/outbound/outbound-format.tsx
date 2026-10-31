import { Pill } from '@/components/dashboard/resource-table';
import type { AIProvider, OutboundIntegration } from '@/lib/api/outbound';
import { formatNumber } from '@/lib/mock-data';
import { formatMillicents as formatUsdMillicents } from '@/lib/money';

export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: 'OpenAI-compatible',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  azure_openai: 'Azure OpenAI',
  bedrock: 'Amazon Bedrock',
  vertex: 'Vertex AI',
};

/** Cost fields are integer millicents of a US dollar (faas dbd63fcb74: USD prices). */
export function formatMillicents(value: number | null | undefined) {
  if (value == null) return '—';
  return formatUsdMillicents(value);
}

export function formatLimit(value: number | null | undefined, unit: string) {
  return value == null ? 'No limit' : `${formatNumber(value)} ${unit}`;
}

/** What the credential situation is, in words that do not depend on colour. */
export function CredentialPill({ integration }: { integration: OutboundIntegration }) {
  if (integration.credential_source === 'operator_env') return <Pill label="Operator-managed" />;
  return integration.credential_configured ? (
    <Pill label="Credential set" color="var(--status-good)" />
  ) : (
    <Pill label="No credential" color="var(--status-warning)" />
  );
}

export const isCustomer = (i: OutboundIntegration) => i.owner_kind === 'customer';
