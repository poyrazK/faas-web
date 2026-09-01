import type { components } from '@/lib/api/schema';

type Req = components['schemas']['SourceRefDeployRequest'];
export type DeployTag = NonNullable<Req['tag']>;

/** Closed set from the spec (ADR-116); the order is the spec's order. */
export const DEPLOY_TAGS: readonly { value: DeployTag; label: string }[] = [
  { value: 'incident_recovery', label: 'Incident recovery' },
  { value: 'hotfix', label: 'Hotfix' },
  { value: 'scheduled_maintenance', label: 'Scheduled maintenance' },
  { value: 'compliance_hold', label: 'Compliance hold' },
  { value: 'partner_request', label: 'Partner request' },
];

export interface AnnotationDraft {
  reason: string;
  tag: DeployTag | '';
  deployed_by: string;
  /** Kept as text so the input can be cleared; parsed on submit. */
  pr_number: string;
}

export const EMPTY_ANNOTATIONS: AnnotationDraft = {
  reason: '',
  tag: '',
  deployed_by: '',
  pr_number: '',
};

/** The API caps `reason` at 280 characters. */
export const REASON_MAX = 280;

export type AnnotationsBody = Pick<Req, 'reason' | 'tag' | 'deployed_by' | 'pr_number'>;

/** Only filled fields go on the wire; the API treats absent and empty differently. */
export function annotationsBody(d: AnnotationDraft): AnnotationsBody {
  const out: AnnotationsBody = {};
  const reason = d.reason.trim();
  if (reason) out.reason = reason.slice(0, REASON_MAX);
  if (d.tag) out.tag = d.tag;
  const by = d.deployed_by.trim();
  if (by) out.deployed_by = by;
  if (/^\d+$/.test(d.pr_number.trim())) out.pr_number = Number(d.pr_number.trim());
  return out;
}
