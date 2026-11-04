import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, LockSlash, RefreshDouble } from 'iconoir-react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api/errors';
import { cn } from '@/lib/utils';
import {
  objectLockKey,
  setBucketObjectLock,
  useBucketObjectLock,
  useObjectLockCapabilities,
  type BucketObjectLock,
  type ObjectBucket,
  type ObjectLockConfiguration,
} from '@/lib/api/object-storage';
import { storageRefusal } from './refusals';
import { StatusChip } from './status-chip';

type Mode = 'GOVERNANCE' | 'COMPLIANCE';
/**
 * ObjectLockDefaultRetention, spelled out: its anyOf/not constraints make the
 * generated type collapse to `unknown`. A mode with a fixed duration (days or
 * years, not both), an event hold duration, or both.
 */
interface DefaultRetention {
  mode: Mode;
  days?: number;
  years?: number;
  default_event_hold?: { days?: number; years?: number };
}
type Unit = 'days' | 'years';

const LABEL = 'flex flex-col gap-1 text-xs text-muted-foreground';
const MAX: Record<Unit, number> = { days: 36_500, years: 100 };

/** Why a lock change is waiting, by apid's `last_error_code` (ObjectBucketObjectLock). */
const WAITING: Record<NonNullable<BucketObjectLock['last_error_code']>, string> = {
  versioning_pending: 'Waiting for versioning to be on.',
  untracked_writes: 'Waiting for writes Gregale has not accounted for to settle.',
  unsettled_writes: 'Waiting for writes in flight to settle.',
  multipart_active: 'Waiting for multipart uploads in progress to finish.',
  capacity_active: 'Waiting for a capacity count to finish.',
  provider_failed: 'Storage refused the change; apid retries on its own.',
  provider_mismatch: 'Storage reported a different setting; apid retries on its own.',
  provider_unsupported: "This bucket's storage does not support the change.",
};

/** Is the lock on, or on its way on? Enabling is permanent, so either counts. */
export function lockEnabled(lock: BucketObjectLock | undefined): boolean {
  return Boolean(
    lock &&
    (lock.enabled_required ||
      lock.observed_configuration?.enabled ||
      lock.desired_configuration?.enabled)
  );
}

const period = (n: number, unit: Unit) => `${n} ${n === 1 ? unit.slice(0, -1) : unit}`;

export function defaultSentence(d: DefaultRetention | undefined): string {
  if (!d) return 'No default retention. A version is protected only when you protect it.';
  const fixed = d.days ? period(d.days, 'days') : d.years ? period(d.years, 'years') : '';
  const hold = d.default_event_hold
    ? d.default_event_hold.days
      ? period(d.default_event_hold.days, 'days')
      : period(d.default_event_hold.years ?? 0, 'years')
    : '';
  const mode = d.mode === 'COMPLIANCE' ? 'compliance' : 'governance';
  const parts = [
    fixed && `New versions are kept for ${fixed}`,
    hold &&
      `${fixed ? 'and' : 'New versions are'} held for ${hold} after an event hold is released`,
  ].filter(Boolean);
  return `${parts.join(' ')}, in ${mode} mode.`;
}

export function ObjectLockSetting({
  slug,
  bucket,
  enabled,
}: {
  slug: string;
  bucket: ObjectBucket;
  enabled: boolean;
}) {
  const lock = useBucketObjectLock(slug, bucket.id);
  const capabilities = useObjectLockCapabilities(slug, bucket.id);
  const unsupported =
    lock.error instanceof ApiError && lock.error.code === 'object_storage_unsupported';
  const phase = queryPhase({
    loading: lock.isPending || capabilities.isPending,
    error: unsupported ? undefined : (lock.error ?? capabilities.error),
  });
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<Mode | ''>('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<Unit>('days');
  const [holdAmount, setHoldAmount] = useState('');
  const [holdUnit, setHoldUnit] = useState<Unit>('days');
  const change = useMutation({
    mutationFn: (configuration: ObjectLockConfiguration) =>
      setBucketObjectLock(slug, bucket.id, configuration),
    onSuccess: (result) => {
      cache.setQueryData(objectLockKey(slug, bucket.id), result);
      setEditing(false);
      toast({
        kind: 'success',
        title: 'Object Lock change accepted',
        description: 'New writes to this bucket pause until storage confirms it.',
      });
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'Object Lock was not changed',
        description: storageRefusal(
          error,
          'Another Object Lock change is still running, or it asks for the opposite of one that is.'
        ),
        error,
      }),
  });

  const l = lock.data;
  const caps = capabilities.data;
  const on = lockEnabled(l);
  const settling = l ? l.state !== 'ready' : false;
  const current = (l?.desired_configuration?.default_retention ??
    l?.observed_configuration?.default_retention) as DefaultRetention | undefined;

  const whole = (text: string, u: Unit) => {
    const n = Number(text);
    return Number.isInteger(n) && n >= 1 && n <= MAX[u];
  };
  const fixedOk = amount.trim() === '' || whole(amount, unit);
  const holdOk = holdAmount.trim() === '' || whole(holdAmount, holdUnit);
  const hasDuration = amount.trim() !== '' || holdAmount.trim() !== '';
  const valid = mode === '' ? true : fixedOk && holdOk && hasDuration;

  const start = () => {
    setMode(current?.mode ?? '');
    setUnit(current?.years ? 'years' : 'days');
    setAmount(String(current?.years ?? current?.days ?? ''));
    const hold = current?.default_event_hold;
    setHoldUnit(hold?.years ? 'years' : 'days');
    setHoldAmount(String(hold?.years ?? hold?.days ?? ''));
    setEditing(true);
  };

  const submit = async () => {
    if (!valid) return;
    const defaults: DefaultRetention | undefined =
      mode === ''
        ? undefined
        : {
            mode,
            ...(amount.trim() ? { [unit]: Number(amount) } : {}),
            ...(holdAmount.trim()
              ? { default_event_hold: { [holdUnit]: Number(holdAmount) } }
              : {}),
          };
    const lines: string[] = [];
    if (!on)
      lines.push(
        `This is permanent: Object Lock can never be turned off for ${bucket.name}, and versioning stays on for good. New writes pause until versioning is on, writes in flight settle and every version is counted.`
      );
    if (defaults?.mode === 'COMPLIANCE')
      lines.push(
        `Compliance mode cannot be undone for what it protects. ${defaultSentence(defaults)} Until that time has passed, nobody can delete or overwrite those versions or shorten their retention: not you, and not Gregale support.`
      );
    if (on && !defaults && current)
      lines.push(
        'New versions will no longer be protected by default. Versions already protected keep their retention.'
      );
    if (defaults?.mode === 'GOVERNANCE')
      lines.push(
        `${defaultSentence(defaults)} Protected versions cannot be deleted or overwritten until it ends.`
      );
    const irreversible = !on || defaults?.mode === 'COMPLIANCE';
    const ok = await confirm({
      title: on
        ? `Change default retention for ${bucket.name}?`
        : `Turn on Object Lock for ${bucket.name}?`,
      description: lines.join(' '),
      confirmLabel: on ? 'Save default' : 'Turn on permanently',
      destructive: irreversible || !defaults,
      ...(irreversible ? { typeToConfirm: bucket.name } : {}),
    });
    if (ok) change.mutate({ enabled: true, ...(defaults ? { default_retention: defaults } : {}) });
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Object Lock</h3>
        {l &&
          (settling ? (
            <StatusChip tone="warning" icon={RefreshDouble} spin label="Applying" />
          ) : on ? (
            <StatusChip tone="good" icon={Lock} label="On" />
          ) : (
            <StatusChip tone="muted" icon={LockSlash} label="Off" />
          ))}
      </div>
      {unsupported || caps?.bucket_configuration === false ? (
        <p className="text-sm text-muted-foreground">
          Object Lock is not available for this bucket&apos;s storage.
        </p>
      ) : phase !== 'ready' || !l || !caps ? (
        <InlinePhase
          phase={phase}
          error={lock.error ?? capabilities.error}
          onRetry={() => {
            void lock.refetch();
            void capabilities.refetch();
          }}
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {on
              ? 'Protected versions cannot be deleted or overwritten until their retention ends or their legal hold is removed. Object Lock stays on for good.'
              : 'Keeps chosen versions from being deleted or overwritten. Turning it on is permanent.'}
          </p>
          {on && <p className="text-sm">{defaultSentence(current)}</p>}
          {settling && (
            <p role="status" className="text-sm text-muted-foreground">
              {(l.last_error_code && WAITING[l.last_error_code]) ||
                'Applying the change to storage.'}{' '}
              New writes are paused until it is ready.
            </p>
          )}
          {editing ? (
            <form
              aria-label={`Object Lock for ${bucket.name}`}
              noValidate
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <label className={LABEL}>
                Default retention for new versions
                <Select value={mode} onChange={(e) => setMode(e.target.value as Mode | '')}>
                  <option value="">None</option>
                  <option value="GOVERNANCE">Governance</option>
                  <option value="COMPLIANCE">Compliance (cannot be undone)</option>
                </Select>
              </label>
              {mode !== '' && (
                <>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className={LABEL}>
                      Keep each version for
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        className={cn(FIELD, 'w-28 tabular-nums')}
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                    </label>
                    <label className={LABEL}>
                      Unit
                      <Select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
                        <option value="days">days</option>
                        <option value="years">years</option>
                      </Select>
                    </label>
                  </div>
                  {caps.default_event_hold && (
                    <div className="flex flex-wrap items-end gap-3">
                      <label className={LABEL}>
                        Keep after an event hold is released
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          placeholder="No event hold"
                          className={cn(FIELD, 'w-36 tabular-nums')}
                          value={holdAmount}
                          onChange={(e) => setHoldAmount(e.target.value)}
                        />
                      </label>
                      <label className={LABEL}>
                        Event hold unit
                        <Select
                          value={holdUnit}
                          onChange={(e) => setHoldUnit(e.target.value as Unit)}
                        >
                          <option value="days">days</option>
                          <option value="years">years</option>
                        </Select>
                      </label>
                    </div>
                  )}
                  {!valid && (
                    <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
                      Give a whole number of days (up to 36,500) or years (up to 100).
                    </p>
                  )}
                  {mode === 'COMPLIANCE' && (
                    <p className="text-xs" style={{ color: 'var(--status-warning)' }}>
                      In compliance mode nobody can delete a protected version or shorten its
                      retention, not even Gregale support. This cannot be undone.
                    </p>
                  )}
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  size="sm"
                  variant={on ? 'default' : 'destructive'}
                  disabled={!valid || change.isPending}
                >
                  {on ? 'Save default' : 'Turn on Object Lock'}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={change.isPending}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={!enabled || settling}
              onClick={start}
            >
              {on ? 'Change default retention' : 'Turn on Object Lock…'}
            </Button>
          )}
        </>
      )}
    </>
  );
}
