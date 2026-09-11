import { useGraceWindow } from '@/lib/api/queries';

/** Both rotation endpoints resolve the account override before the plan default. */
export function useKeyRotationPolicy() {
  const query = useGraceWindow();
  const days =
    query.data && !query.error ? (query.data.days ?? query.data.plan_default) : undefined;
  const source = `${query.data?.days == null ? 'Using the plan default.' : 'Using the account override.'} This account-wide policy applies to future personal and organisation key rotations; creating a key does not set a policy for that key.`;
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
