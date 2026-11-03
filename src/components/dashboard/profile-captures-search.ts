import type { ProfileKind } from '@/lib/api/profile-captures';

/** The capture, kind and comparison baseline the Profile captures tab has open, in the URL. */
export interface ProfileCaptureSearch {
  capture?: string;
  captureKind?: ProfileKind;
  captureBase?: string;
}

const KINDS: readonly ProfileKind[] = ['cpu', 'heap', 'stacks', 'block', 'mutex'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateProfileCaptureSearch(raw: Record<string, unknown>): ProfileCaptureSearch {
  const id = (value: unknown) =>
    typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : undefined;
  return {
    capture: id(raw.capture),
    captureKind: KINDS.includes(raw.captureKind as ProfileKind)
      ? (raw.captureKind as ProfileKind)
      : undefined,
    captureBase: id(raw.captureBase),
  };
}
