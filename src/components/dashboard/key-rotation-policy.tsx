import { useGraceWindow } from '@/lib/api/queries';

/** Org rotation preserves its existing empty body; the API documents plan fallback. */
export function useKeyRotationPolicy(scope: 'personal' | 'organisation') {
  const query = useGraceWindow();
  const days =
    query.data && !query.error
      ? scope === 'organisation'
        ? query.data.plan_default
        : (query.data.days ?? query.data.plan_default)
      : undefined;
  const source =
    scope === 'organisation'
      ? 'Organisation rotations here use the plan default.'
      : `${query.data?.days == null ? 'Using the plan default.' : 'Using the account override.'} This account-wide policy applies to future rotations; creating a key does not set a policy for that key.`;
  const context =
    days === undefined
      ? query.error
        ? 'Rotation policy unavailable. Reload before rotating a key.'
        : 'Reading rotation policy…'
      : `Effective grace window: ${days} days. ${days === 0 ? 'The previous key stops working immediately.' : `The previous key works for ${days} days after rotation, then stops.`} ${source}`;
  return { days, context };
}

export function KeyRotationContext({ context }: { context: string }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{context}</p>;
}
