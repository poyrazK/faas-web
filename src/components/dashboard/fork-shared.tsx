import type { CheckCircle } from 'iconoir-react';
import { OneTimeSecret } from '@/components/ui/one-time-secret';
import { ApiError } from '@/lib/api/errors';
import { FORK_TTL } from '@/lib/api/forks';

/*
 * What a fork made from the Forks panel and one opened from a crash snapshot
 * share: the lifetime choice, the one-time access token, and what a refused
 * create means (faas pkg/api/app_forks.go, crash_snapshots.go).
 */

/** Lifetimes inside api.AppForkMinTTL..AppForkMaxTTL; the API's default is the preset. */
export const LIFETIMES = [
  [900, '15 minutes'],
  [1800, '30 minutes'],
  [3600, '1 hour'],
  [7200, '2 hours'],
  [14400, '4 hours'],
] as const satisfies readonly (readonly [number, string])[];

export function lifetimeLabel(seconds: number): string {
  return LIFETIMES.find(([s]) => s === seconds)?.[1] ?? `${Math.round(seconds / 60)} minutes`;
}

export function LifetimeSelect({
  value,
  onChange,
  id,
}: {
  value: number;
  onChange: (seconds: number) => void;
  id: string;
}) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <label htmlFor={id}>Lifetime</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:border-brand/50"
      >
        {LIFETIMES.map(([seconds, label]) => (
          <option key={seconds} value={seconds}>
            {label}
            {seconds === FORK_TTL.default ? ' (default)' : ''}
          </option>
        ))}
      </select>
    </span>
  );
}

/** The confirm text every fork create shares: what is copied, who can reach it, how long it lives. */
export function forkConsequences(seconds: number): string {
  return `It runs in a private VM with no network and never receives production traffic. Only requests carrying its access token reach it; the token is shown once, next, and anyone holding it can send the fork requests until it ends ${lifetimeLabel(seconds)} from now or you cancel it. It is billed like a running instance while it runs, and the create is recorded in your audit log.`;
}

/**
 * A refused fork create, by the stable code (faas pkg/api/app_forks.go:112-178,
 * crash_snapshots.go:41-77). Anything else falls through with apid's own words.
 */
export function forkWriteFailure(error: unknown): { title: string; description?: string } {
  const code = error instanceof ApiError ? error.code : '';
  switch (code) {
    case 'app_fork_limit':
      return {
        title: 'Active fork limit reached',
        description:
          'One fork per app and two per account can be active. Cancel one, or wait for it to end.',
      };
    case 'app_fork_unavailable':
      return { title: 'Nothing to fork', description: 'The app has no live deployment yet.' };
    case 'live_fork_refused':
      return {
        title: 'Live capture not started',
        description:
          'No instance is running, a capture is already in progress, or one was taken in the last minute. Send the app a request, or fork its last snapshot.',
      };
    case 'live_forks_not_enabled':
      return {
        title: 'Live forks are off on this installation',
        description: 'Fork the last snapshot instead.',
      };
    case 'crash_capture_not_ready':
      return {
        title: 'Snapshot not ready',
        description: 'Only a ready, unexpired crash snapshot opens as a fork.',
      };
    case 'plan_app_forks_not_allowed':
      return { title: 'Your plan does not include production forks' };
    case 'app_forks_not_enabled':
    case 'crash_snapshots_not_enabled':
      return { title: 'Forks are not enabled on this installation' };
    default:
      return { title: 'Could not create the fork' };
  }
}

/**
 * The fork's access token, once. It never enters a cache, and the running
 * fork's curl line names it by a shell variable, so the plaintext is only ever
 * in the masked field.
 */
export function ForkToken({
  forkId,
  token,
  onDismiss,
}: {
  forkId: string;
  token: string;
  onDismiss: () => void;
}) {
  return (
    <OneTimeSecret
      value={token}
      title="Fork access token"
      description={`Send it with X-Gregale-Fork: ${forkId} and X-Gregale-Fork-Token to the app's own hostname once the fork is running; the gateway routes the request to this fork only and strips both headers. Gregale keeps only its hash, so it cannot be shown again.`}
      onDismiss={onDismiss}
    />
  );
}

export function ForkRequestHint({ forkId }: { forkId: string }) {
  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      <code className="block overflow-x-auto whitespace-pre rounded-md bg-muted px-2 py-1.5 font-mono text-foreground">
        {`curl -H "X-Gregale-Fork: ${forkId}" \\\n     -H "X-Gregale-Fork-Token: $FORK_TOKEN" \\\n     https://<your app's hostname>/`}
      </code>
      <span>
        A wrong token, an unknown fork, or one that is not running answers 404{' '}
        <code className="font-mono">fork_not_found</code>. Ordinary requests never reach a fork.
      </span>
    </div>
  );
}

/** Colour, icon and label, so a state never rests on hue alone. */
export function StatusChip({
  label,
  color,
  icon: Icon,
}: {
  label: string;
  color: string;
  icon: typeof CheckCircle;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, color }}
    >
      <Icon aria-hidden className="size-3" />
      {label}
    </span>
  );
}
