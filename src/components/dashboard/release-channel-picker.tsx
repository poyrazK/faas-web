import { useNotificationChannels } from '@/lib/api/notification-channels';
import { InlinePhase, queryPhase } from './primitives';

/**
 * Notification channels for release events, by name: scheduled releases and
 * the approval policy name channels rather than ids, take at most five, and
 * accept Slack and email only — a release waiting or starting is not an
 * incident, so PagerDuty is refused (faas release_approvals.go:169-198).
 */
export function ReleaseChannelPicker({
  value,
  onChange,
  idPrefix,
  max = 5,
  legend = 'Notify',
}: {
  value: string[];
  onChange: (names: string[]) => void;
  idPrefix: string;
  max?: number;
  legend?: string;
}) {
  const channels = useNotificationChannels();
  const usable = (channels.data ?? []).filter((c) => c.kind !== 'pagerduty');
  const phase = queryPhase({
    error: channels.error,
    loading: channels.isPending,
    isEmpty: usable.length === 0,
  });
  const full = value.length >= max;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="label-mono text-muted-foreground">{legend}</legend>
      {phase !== 'ready' ? (
        <div className="flex flex-wrap items-center gap-x-3 pt-1.5 text-xs">
          <InlinePhase
            phase={phase}
            error={channels.error}
            loadingMessage="Reading channels…"
            emptyMessage="No Slack or email channels yet."
            onRetry={() => void channels.refetch()}
          />
          {phase === 'empty' && (
            <a className="text-brand underline" href="/dashboard/alerts?view=channels">
              Add a channel
            </a>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 pt-1.5">
          {usable.map((channel) => {
            const on = value.includes(channel.name);
            return (
              <label
                key={channel.id}
                className="pressable flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs has-[:checked]:border-brand has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"
              >
                <input
                  id={`${idPrefix}-${channel.id}`}
                  type="checkbox"
                  checked={on}
                  disabled={!on && full}
                  onChange={() =>
                    onChange(
                      on ? value.filter((n) => n !== channel.name) : [...value, channel.name]
                    )
                  }
                />
                <span className="font-mono">{channel.name}</span>
                <span className="text-muted-foreground">{channel.kind}</span>
              </label>
            );
          })}
        </div>
      )}
      <span className="text-xs text-muted-foreground">
        Slack or email, up to {max}. PagerDuty is not offered: a release is not an incident.
      </span>
    </fieldset>
  );
}
