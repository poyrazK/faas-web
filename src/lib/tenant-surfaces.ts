import type { components } from '@/lib/api/schema';

export type TenantSurface = components['schemas']['TenantSurfaceResponse'];
export type TenantHostname = components['schemas']['TenantHostnameResponse'];

export function hostnameState(h: TenantHostname): 'verified' | 'pending' | 'failed' {
  if (h.verified) return 'verified';
  return h.last_error ? 'failed' : 'pending';
}

/** Colour for the surface's certificate lifecycle. */
export function certTone(
  state: TenantSurface['cert_state'] | string
): 'good' | 'warning' | 'bad' | 'neutral' {
  switch (state) {
    case 'issued':
      return 'good';
    case 'pending':
    case 'renewing':
      return 'warning';
    case 'failed':
      return 'bad';
    default:
      return 'neutral';
  }
}
