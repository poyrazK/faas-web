import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD, FieldError, fieldErrorProps, useFormValidation } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useUpdateCron } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';
import { errorMessage } from '@/lib/api/errors';
import { ScheduleField, useScheduleClock } from './schedule-field';
import {
  cronScheduleError,
  effectiveOverlap,
  OverlapField,
  overlapPolicy,
  TimezoneField,
  type Overlap,
} from './cron-fields';

type CronResponse = components['schemas']['CronResponse'];
type UpdateCronRequest = components['schemas']['UpdateCronRequest'];

interface Draft {
  schedule: string;
  path: string;
  timezone: string;
  overlap: Overlap;
  retryMax: string;
  retryBackoff: string;
}

const draftOf = (cron: CronResponse): Draft => ({
  schedule: cron.schedule,
  path: cron.path ?? '/',
  timezone: cron.timezone || 'UTC',
  overlap: effectiveOverlap(cron),
  retryMax: String(cron.retry_max ?? 0),
  retryBackoff: String(cron.retry_backoff_seconds ?? 60),
});

/** A whole number in `[min, max]`, written as digits only. */
const wholeNumber = (text: string, min: number, max: number) =>
  /^\d+$/.test(text.trim()) && Number(text) >= min && Number(text) <= max;

/**
 * What differs between the cron and the draft: the PATCH body (changed fields
 * only, so an untouched field is never overwritten) and a label for each.
 */
function diff(cron: CronResponse, draft: Draft) {
  const before = draftOf(cron);
  const patch: UpdateCronRequest = {};
  const changed: string[] = [];
  if (draft.schedule.trim() !== before.schedule) {
    patch.schedule = draft.schedule.trim();
    changed.push('schedule');
  }
  if (cron.kind === 'http' && (draft.path.trim() || '/') !== before.path) {
    patch.path = draft.path.trim() || '/';
    changed.push('path');
  }
  if ((draft.timezone.trim() || 'UTC') !== before.timezone) {
    patch.timezone = draft.timezone.trim() || 'UTC';
    changed.push('timezone');
  }
  if (draft.overlap !== before.overlap) {
    patch.schedule_policy = overlapPolicy(cron, draft.overlap);
    changed.push('overlap');
  }
  if (cron.kind === 'command') {
    // An invalid number still counts as a change, so submitting reports the
    // problem instead of leaving Save mysteriously disabled.
    if (draft.retryMax.trim() !== before.retryMax) {
      if (wholeNumber(draft.retryMax, 0, 5)) patch.retry_max = Number(draft.retryMax);
      changed.push('retries');
    }
    if (draft.retryBackoff.trim() !== before.retryBackoff) {
      if (wholeNumber(draft.retryBackoff, 1, 3600))
        patch.retry_backoff_seconds = Number(draft.retryBackoff);
      changed.push('retry delay');
    }
  }
  return { patch, changed };
}

const sentence = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** Edit one scheduled request in place, keeping its id and run history. */
export function EditCronDialog({
  cron,
  target,
  onClose,
}: {
  cron: CronResponse;
  /** The path, or the command line for a command cron, as the table shows it. */
  target: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const updateCron = useUpdateCron();
  const [draft, setDraft] = useState(() => draftOf(cron));
  const [error, setError] = useState<string | null>(null);
  const validation = useFormValidation<'schedule' | 'retry_max' | 'retry_backoff_seconds'>();
  const scheduleInput = useRef<HTMLInputElement>(null);
  const now = useScheduleClock();

  useEffect(() => {
    const frame = requestAnimationFrame(() => scheduleInput.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));
  const command = cron.kind === 'command';
  const scheduleError = cronScheduleError(draft.schedule, now);
  const retryMaxError = wholeNumber(draft.retryMax, 0, 5)
    ? undefined
    : 'Enter a whole number from 0 to 5.';
  const backoffError = wholeNumber(draft.retryBackoff, 1, 3600)
    ? undefined
    : 'Enter a whole number of seconds from 1 to 3600.';
  const shown = validation.submitAttempted;
  const { patch, changed } = diff(cron, draft);
  const close = () => {
    if (!updateCron.isPending) onClose();
  };

  return (
    <Modal
      open
      onClose={close}
      title="Edit scheduled request"
      description="Changes apply from the next run. Run history and the request id stay the same."
      width="max-w-lg"
    >
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (updateCron.isPending || changed.length === 0) return;
          if (
            !validation.validate(
              {
                schedule: scheduleError,
                ...(command
                  ? { retry_max: retryMaxError, retry_backoff_seconds: backoffError }
                  : {}),
              },
              e.currentTarget
            )
          )
            return;
          setError(null);
          void updateCron
            .mutateAsync({ id: cron.id, ...patch })
            .then(() => {
              toast({
                kind: 'success',
                title: 'Scheduled request updated',
                description: `Changed ${sentence(changed)}.`,
              });
              onClose();
            })
            .catch((err: unknown) => setError(errorMessage(err)));
        }}
      >
        <div className="max-h-[calc(100dvh-14rem)] space-y-5 overflow-y-auto p-1">
          <fieldset disabled={updateCron.isPending} className="space-y-5">
            <ScheduleField
              value={draft.schedule}
              onChange={(value) => set('schedule', value)}
              inputRef={scheduleInput}
              error={shown ? scheduleError : undefined}
              timezone={draft.timezone}
            />
            <TimezoneField value={draft.timezone} onChange={(value) => set('timezone', value)} />
            {command ? (
              <div className="flex flex-col gap-1.5">
                <span className="label-mono text-muted-foreground">Command</span>
                <code className="text-xs">{target}</code>
                <p className="text-xs text-muted-foreground">
                  The command cannot be changed here. Delete and recreate the schedule to change it.
                </p>
              </div>
            ) : (
              <label className="flex flex-col gap-1.5">
                <span className="label-mono text-muted-foreground">Path</span>
                <input
                  name="path"
                  value={draft.path}
                  onChange={(e) => set('path', e.target.value)}
                  placeholder="/run"
                  spellCheck={false}
                  className={`${FIELD} w-full font-mono`}
                />
              </label>
            )}
            <OverlapField
              value={draft.overlap}
              onChange={(value) => set('overlap', value)}
              kind={command ? 'command' : 'http'}
            />
            {command && (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono text-muted-foreground">Retries</span>
                  <input
                    name="retry_max"
                    type="number"
                    min={0}
                    max={5}
                    value={draft.retryMax}
                    onChange={(e) => set('retryMax', e.target.value)}
                    {...fieldErrorProps(shown ? retryMaxError : undefined, 'cron-retry-max-error')}
                    className={`${FIELD} w-full`}
                  />
                  {shown && retryMaxError && (
                    <FieldError id="cron-retry-max-error">{retryMaxError}</FieldError>
                  )}
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono text-muted-foreground">Retry delay (seconds)</span>
                  <input
                    name="retry_backoff_seconds"
                    type="number"
                    min={1}
                    max={3600}
                    value={draft.retryBackoff}
                    onChange={(e) => set('retryBackoff', e.target.value)}
                    {...fieldErrorProps(shown ? backoffError : undefined, 'cron-retry-delay-error')}
                    className={`${FIELD} w-full`}
                  />
                  {shown && backoffError && (
                    <FieldError id="cron-retry-delay-error">{backoffError}</FieldError>
                  )}
                </label>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  A failed or timed-out run is retried this many times. The delay doubles after each
                  retry.
                </p>
              </div>
            )}
          </fieldset>
          {error && (
            <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
              {error}
            </p>
          )}
        </div>
        <footer className="-mx-5 -mb-4 flex justify-end gap-2 border-t border-border px-5 py-3.5">
          <Button type="button" variant="ghost" disabled={updateCron.isPending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={changed.length === 0} busy={updateCron.isPending}>
            Save changes
          </Button>
        </footer>
      </form>
    </Modal>
  );
}
