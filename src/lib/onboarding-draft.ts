import { appNameError } from '@/components/dashboard/new-app-validation';
import { resourceId } from './resource-id';
import { FUNCTION_STARTERS } from './function-starters';

export interface OnboardingOwner {
  account: string;
  workspace: string | null;
}
export type SubmissionPhase =
  'preparing' | 'creating' | 'submitting' | 'accepted' | 'rejected' | 'unknown';
type CommonDraft = { app?: string; deployment?: string; name?: string; phase: SubmissionPhase };
export type OnboardingDraft = CommonDraft &
  (
    | { kind: 'sample'; starter: string }
    | { kind: 'git'; repo: string; ref: string; installation?: string }
    | { kind: 'existing'; app: string }
  );
export interface OnboardingRecord {
  version: 1;
  owner: OnboardingOwner;
  dismissed: boolean;
  draft?: OnboardingDraft;
}

// A changed starter cannot silently become the source of a restored submission.
export function sampleVersion(): string {
  const starter = FUNCTION_STARTERS.node;
  const text = JSON.stringify([starter.runtime, starter.code, starter.extra]);
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `node-${(hash >>> 0).toString(36)}`;
}
export function onboardingKey(owner: OnboardingOwner) {
  return `gregale.onboarding.v2.${encodeURIComponent(owner.account)}.${encodeURIComponent(owner.workspace ?? '')}`;
}
function bounded(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.length <= max &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  );
}
export function validateOnboardingDraft(raw: unknown): OnboardingDraft | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const d = raw as Record<string, unknown>;
  if (
    typeof d.phase !== 'string' ||
    !['preparing', 'creating', 'submitting', 'accepted', 'rejected', 'unknown'].includes(
      String(d.phase)
    )
  )
    return;
  if (d.app !== undefined && (!bounded(d.app, 40) || appNameError(d.app))) return;
  if (d.name !== undefined && (!bounded(d.name, 40) || !/^[a-z0-9-]*$/.test(d.name))) return;
  if (d.deployment !== undefined && (!d.app || !resourceId(d.deployment))) return;
  const common: CommonDraft = {
    phase: d.phase as SubmissionPhase,
    ...(d.app ? { app: d.app as string } : {}),
    ...(d.name ? { name: d.name as string } : {}),
    ...(d.deployment ? { deployment: d.deployment as string } : {}),
  };
  if (d.kind === 'existing' && common.app) return { ...common, kind: 'existing', app: common.app };
  if (d.kind === 'sample' && bounded(d.starter, 64) && /^node-[a-z0-9]+$/.test(d.starter))
    return { ...common, kind: 'sample', starter: d.starter };
  if (
    d.kind === 'git' &&
    bounded(d.repo, 512) &&
    /^[a-zA-Z0-9._/-]*$/.test(d.repo) &&
    bounded(d.ref, 200)
  )
    return {
      ...common,
      kind: 'git',
      repo: d.repo,
      ref: d.ref,
      ...(typeof d.installation === 'string' && /^[1-9][0-9]{0,14}$/.test(d.installation)
        ? { installation: d.installation }
        : {}),
    };
}
export function readOnboarding(owner: OnboardingOwner): OnboardingRecord {
  const empty: OnboardingRecord = { version: 1, owner, dismissed: false };
  if (!owner.account || typeof window === 'undefined') return empty;
  try {
    const raw = JSON.parse(localStorage.getItem(onboardingKey(owner)) ?? 'null');
    if (
      raw?.version !== 1 ||
      raw.owner?.account !== owner.account ||
      raw.owner?.workspace !== owner.workspace
    )
      return empty;
    const draft = validateOnboardingDraft(raw.draft);
    // A page reload cannot know whether an interrupted mutation reached the API.
    return {
      ...empty,
      dismissed: raw.dismissed === true,
      ...(draft
        ? {
            draft: {
              ...draft,
              phase:
                draft.phase === 'creating' || draft.phase === 'submitting'
                  ? 'unknown'
                  : draft.phase,
            },
          }
        : {}),
    };
  } catch {
    return empty;
  }
}
export function writeOnboarding(record: OnboardingRecord) {
  if (!record.owner.account || typeof window === 'undefined') return;
  const draft = validateOnboardingDraft(record.draft);
  try {
    localStorage.setItem(
      onboardingKey(record.owner),
      JSON.stringify({
        version: 1,
        owner: record.owner,
        dismissed: record.dismissed === true,
        ...(draft ? { draft } : {}),
      })
    );
  } catch {
    /* The live form still works when storage is unavailable. */
  }
}

/** Only gates access to the rollback-safe reader, never counts as completion. */
export function hasOnboardingRecovery(account: string): boolean {
  if (!account || typeof window === 'undefined') return false;
  try {
    const prefix = `gregale.onboarding.v2.${encodeURIComponent(account)}.`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      let raw;
      try {
        raw = JSON.parse(localStorage.getItem(key) ?? 'null');
      } catch {
        continue;
      }
      if (
        raw?.owner?.account !== account ||
        !(raw.owner.workspace === null || typeof raw.owner.workspace === 'string')
      )
        continue;
      const record = readOnboarding({ account, workspace: raw.owner.workspace });
      if (record.draft?.app || record.draft?.phase === 'unknown') return true;
    }
  } catch {
    /* A denied storage area cannot grant a recovery action. */
  }
  return false;
}
