import type { components } from '@/lib/api/schema';

type Status = components['schemas']['AppStreamingStatus']['status'];

export const STREAMING_STATUS: Record<
  Status,
  { label: string; tone: 'good' | 'warning' | 'bad' | 'neutral'; hint: string }
> = {
  streaming: {
    label: 'Streaming',
    tone: 'good',
    hint: 'Responses stream to the client as they are produced.',
  },
  'accept-json-downgrade': {
    label: 'Buffered for JSON',
    tone: 'warning',
    hint: 'Clients sending Accept: application/json get a buffered response.',
  },
  'flag-disabled': {
    label: 'Off (flag)',
    tone: 'neutral',
    hint: 'Streaming is switched off for this app.',
  },
  'plan-disallows': {
    label: 'Off (plan)',
    tone: 'warning',
    hint: 'Your plan does not include streaming responses.',
  },
  'operator-disabled': {
    label: 'Off (platform)',
    tone: 'bad',
    hint: 'Streaming is disabled platform-wide right now.',
  },
  'upgrade-bypass': {
    label: 'Streaming (upgrade)',
    tone: 'good',
    hint: 'Protocol upgrades bypass the cap.',
  },
};

export function capLabel(bytes: number): string {
  if (bytes === 0) return 'unlimited';
  if (bytes >= 1024 * 1024) return `${+(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${+(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
