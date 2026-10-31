import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useCancelPrewarm, usePrewarms, useSchedulePrewarm } from '@/lib/api/prewarm';
import { cn } from '@/lib/utils';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { Pill } from './resource-table';

/** `datetime-local` speaks local wall time; the API wants an instant. */
export function localInputToIso(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'var(--status-warning)',
  running: 'var(--brand)',
  succeeded: 'var(--status-good)',
  failed: 'var(--status-critical)',
  cancelled: 'var(--muted-foreground)',
};

/**
 * Capacity ahead of a known spike — a launch, a scheduled batch, a demo.
 * apid restores up to `count` instances about a minute before the window
 * starts, through the normal plan and capacity gates, and lets them go when
 * it ends. The permanent minimum instances setting is never touched.
 */
export function PrewarmPanel({ slug }: { slug: string }) {
  const prewarms = usePrewarms(slug);
  const schedule = useSchedulePrewarm(slug);
  const cancel = useCancelPrewarm(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const id = useId();
  const [count, setCount] = useState('1');
  const [start, setStart] = useState(() => toLocalInput(new Date(Date.now() + 3600_000)));
  const [end, setEnd] = useState(() => toLocalInput(new Date(Date.now() + 7200_000)));
  const [attempted, setAttempted] = useState(false);
  // "Now" is read when the form is submitted, never during render.
  const [startedInPast, setStartedInPast] = useState(false);
  const wakeAt = localInputToIso(start);
  const expiresAt = localInputToIso(end);
  const countValue = Number(count);
  const error =
    !Number.isInteger(countValue) || countValue < 1
      ? 'Enter a whole number of instances, at least 1.'
      : !wakeAt || !expiresAt
        ? 'Enter a start and an end.'
        : Date.parse(expiresAt) <= Date.parse(wakeAt)
          ? 'The window must end after it starts.'
          : startedInPast
            ? 'The window must start in the future.'
            : undefined;

  const submit = async () => {
    setAttempted(true);
    const past = !!wakeAt && Date.parse(wakeAt) < Date.now();
    setStartedInPast(past);
    if (past || (error && !startedInPast) || !wakeAt || !expiresAt) return;
    try {
      await schedule.mutateAsync({ count: countValue, wake_at: wakeAt, expires_at: expiresAt });
      setAttempted(false);
      toast({ kind: 'success', title: 'Prewarm scheduled' });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not schedule', error: err });
    }
  };

  const items = [...(prewarms.data ?? [])].sort(
    (a, b) => Date.parse(b.wake_at) - Date.parse(a.wake_at)
  );
  return (
    <Panel
      title="Prewarm"
      description="Have instances ready for a known spike. They start about a minute before the window and go when it ends; your minimum instances setting is unchanged."
    >
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          Instances
          <input
            type="number"
            min={1}
            value={count}
            onChange={(event) => setCount(event.target.value)}
            className={cn(FIELD, 'w-24 tabular-nums')}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          From
          <input
            type="datetime-local"
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
              setStartedInPast(false);
            }}
            className={cn(FIELD, 'w-56')}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-medium">
          Until
          <input
            type="datetime-local"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            className={cn(FIELD, 'w-56')}
          />
        </label>
        <Button type="submit" size="sm" busy={schedule.isPending}>
          Schedule prewarm
        </Button>
        {attempted && error && (
          <div className="w-full">
            <FieldError id={`${id}-error`}>{error}</FieldError>
          </div>
        )}
      </form>
      <div className="mt-5">
        {items.length ? (
          <ul aria-label="Prewarms" className="divide-y divide-border text-sm">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                <Pill label={item.status} color={STATUS_COLOR[item.status]} />
                <span className="tabular-nums">
                  {item.admitted_count !== undefined && item.status !== 'pending'
                    ? `${item.admitted_count} of ${item.count}`
                    : item.count}{' '}
                  instances
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(item.wake_at).toLocaleString()} →{' '}
                  {new Date(item.expires_at).toLocaleString()}
                </span>
                {item.last_error && (
                  <span className="text-xs text-[color:var(--status-critical)]">
                    {item.last_error}
                  </span>
                )}
                {item.status === 'pending' && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: 'Cancel this prewarm?',
                          description: 'No instances will be started for this window.',
                          confirmLabel: 'Cancel prewarm',
                        }))
                      )
                        return;
                      void cancel.mutateAsync(item.id).catch((err: unknown) =>
                        toast({
                          kind: 'error',
                          title: 'Could not cancel',
                          error: err,
                        })
                      );
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <InlinePhase
            phase={queryPhase({
              error: prewarms.error,
              loading: prewarms.isPending,
              isEmpty: true,
            })}
            error={prewarms.error}
            emptyMessage="No prewarms scheduled."
            onRetry={() => void prewarms.refetch()}
          />
        )}
      </div>
    </Panel>
  );
}
