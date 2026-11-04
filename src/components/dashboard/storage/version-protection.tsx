import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Circle, Lock, LockSlash, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, Select } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import type { components } from '@/lib/api/schema';
import {
  protectionKey,
  setVersionLegalHold,
  setVersionRetention,
  useProtectionOperation,
  useVersionLegalHold,
  useVersionRetention,
  type ObjectBucket,
  type ObjectVersion,
  type VersionProtection as Operation,
  type VersionRetention,
} from '@/lib/api/object-storage';
import { storageRefusal } from './refusals';
import { StatusChip } from './status-chip';

type LockCapabilities = components['schemas']['ObjectLockCapabilities'];
type Mode = NonNullable<VersionRetention['mode']>;
type Unit = 'days' | 'years';

const LABEL = 'flex flex-col gap-1 text-xs text-muted-foreground';
const MODE_WORD: Record<Mode, string> = { GOVERNANCE: 'governance', COMPLIANCE: 'compliance' };

/** Retention still protects the version: it cannot be shortened or cleared (docs/object-storage.md). */
export function retentionActive(r: VersionRetention | undefined, now = Date.now()): boolean {
  if (!r) return false;
  if (r.event_hold === 'ON') return true;
  return Boolean(r.retain_until_date && Date.parse(r.retain_until_date) > now);
}

/**
 * What is wrong with a requested fixed date: it must be in the future, must not
 * shorten active retention, and compliance never becomes governance.
 */
export function retentionProblem(
  until: string,
  mode: Mode,
  current: VersionRetention | undefined,
  now = Date.now()
): string {
  if (!until) return '';
  const at = Date.parse(`${until}T00:00:00Z`);
  const active = retentionActive(current, now);
  if (!(at > now)) return 'Pick a date in the future.';
  if (active && current?.retain_until_date && at < Date.parse(current.retain_until_date))
    return 'Active retention cannot be shortened.';
  if (active && current?.mode === 'COMPLIANCE' && mode === 'GOVERNANCE')
    return 'Compliance retention cannot be changed to governance.';
  return '';
}

const LAST_ERROR: Record<NonNullable<Operation['last_error_code']>, string> = {
  provider_uncertain: 'storage did not confirm it',
  provider_unsupported: "this bucket's storage does not support it",
  provider_mismatch: 'storage reported a different setting',
  preparation_failed: 'it could not be prepared',
  provider_rejected: 'storage refused it',
};

/**
 * Retention, legal hold and event hold for one exact version. Every change is
 * an operation apid accepts durably and a worker applies, so the panel follows
 * the operation until it is ready or failed (faas pkg/apid/object/version_protection.go).
 */
export function VersionProtection({
  slug,
  bucket,
  version,
  capabilities,
}: {
  slug: string;
  bucket: ObjectBucket;
  version: ObjectVersion;
  capabilities: LockCapabilities;
}) {
  const key = version.key;
  const id = version.version_id;
  const hold = useVersionLegalHold(slug, bucket.id, key, id, capabilities.version_legal_hold);
  const retention = useVersionRetention(slug, bucket.id, key, id, capabilities.version_retention);
  const [operation, setOperation] = useState('');
  const op = useProtectionOperation(slug, bucket.id, operation);
  const cache = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const refresh = () =>
    void cache.invalidateQueries({ queryKey: protectionKey(slug, bucket.id, key, id) });
  const settled = op.data?.state === 'ready' || op.data?.state === 'failed';
  useEffect(() => {
    if (settled) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  const change = useMutation({
    mutationFn: (task: () => Promise<Operation>) => task(),
    onSuccess: (result) => {
      setOperation(result.id);
      cache.setQueryData(
        ['apps', slug, 'buckets', bucket.id, 'protection-operations', result.id],
        result
      );
    },
    onError: (error) =>
      toast({
        kind: 'error',
        title: 'Protection was not changed',
        description: storageRefusal(
          error,
          'Another protection change for this version is still running, or it would shorten or remove active retention.'
        ),
        error,
      }),
  });

  const [mode, setMode] = useState<Mode>('GOVERNANCE');
  const [until, setUntil] = useState('');
  const [holdAmount, setHoldAmount] = useState('');
  const [holdUnit, setHoldUnit] = useState<Unit>('days');
  const r = retention.data?.retention;
  const active = retentionActive(r);
  const legalOn = hold.data?.legal_hold.status === 'ON';
  const busy = change.isPending || (Boolean(operation) && !settled);

  const toggleHold = async () => {
    if (legalOn) {
      const ok = await confirm({
        title: `Remove the legal hold on this version of ${key}?`,
        description:
          'The version can be deleted or overwritten again, unless retention still protects it.',
        confirmLabel: 'Remove hold',
        destructive: true,
      });
      if (!ok) return;
    }
    change.mutate(() => setVersionLegalHold(slug, bucket.id, key, id, legalOn ? 'OFF' : 'ON'));
  };

  // A new fixed date must not shorten active retention, and compliance never becomes governance.
  const untilProblem = retentionProblem(until, mode, r);

  const setRetention = async () => {
    if (!until || untilProblem) return;
    const compliance = mode === 'COMPLIANCE';
    const ok = await confirm({
      title: `Retain this version of ${key} until ${until}?`,
      description: compliance
        ? 'Compliance mode cannot be undone. Until that date nobody can delete or overwrite this version or shorten its retention: not you, and not Gregale support.'
        : 'Until that date the version cannot be deleted or overwritten, and the retention cannot be shortened or removed.',
      confirmLabel: 'Set retention',
      destructive: true,
      ...(compliance ? { typeToConfirm: key } : {}),
    });
    if (ok)
      change.mutate(() =>
        setVersionRetention(slug, bucket.id, key, id, {
          mode,
          retain_until_date: `${until}T00:00:00Z`,
        })
      );
  };

  const clearRetention = async () => {
    const ok = await confirm({
      title: `Clear the expired retention on this version of ${key}?`,
      description: 'The retention has ended; clearing removes its record from the version.',
      confirmLabel: 'Clear retention',
    });
    if (ok) change.mutate(() => setVersionRetention(slug, bucket.id, key, id, {}));
  };

  const holdOk = (() => {
    const n = Number(holdAmount);
    return Number.isInteger(n) && n >= 1 && n <= (holdUnit === 'days' ? 36_500 : 100);
  })();
  const placeEventHold = async () => {
    if (!holdOk) return;
    const ok = await confirm({
      title: `Place an event hold on this version of ${key}?`,
      description: `The version is protected until you release the hold, then for ${holdAmount} more ${holdUnit} in ${MODE_WORD[mode]} mode.${mode === 'COMPLIANCE' ? ' Compliance mode cannot be undone.' : ''}`,
      confirmLabel: 'Place event hold',
      destructive: true,
      ...(mode === 'COMPLIANCE' ? { typeToConfirm: key } : {}),
    });
    if (ok)
      change.mutate(() =>
        setVersionRetention(slug, bucket.id, key, id, {
          mode,
          event_hold: 'ON',
          event_hold_duration: { [holdUnit]: Number(holdAmount) },
        })
      );
  };
  const releaseEventHold = async () => {
    const ok = await confirm({
      title: `Release the event hold on this version of ${key}?`,
      description:
        'Its retention period starts now; storage fixes the final date, and the version stays protected until then.',
      confirmLabel: 'Release hold',
    });
    if (ok)
      change.mutate(() =>
        setVersionRetention(slug, bucket.id, key, id, { mode: r?.mode, event_hold: 'OFF' })
      );
  };

  const holdPhase = queryPhase({ loading: hold.isPending, error: hold.error });
  const retentionPhase = queryPhase({ loading: retention.isPending, error: retention.error });

  return (
    <div
      role="group"
      aria-label={`Protection for version ${id}`}
      className="flex basis-full flex-col gap-4 rounded-xl border border-border p-4"
    >
      {capabilities.version_legal_hold && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Legal hold</span>
          {holdPhase !== 'ready' ? (
            <InlinePhase phase={holdPhase} error={hold.error} onRetry={() => void hold.refetch()} />
          ) : (
            <>
              {legalOn ? (
                <StatusChip tone="good" icon={Lock} label="On" />
              ) : (
                <StatusChip tone="muted" icon={LockSlash} label="Off" />
              )}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void toggleHold()}>
                {legalOn ? 'Remove legal hold' : 'Place legal hold'}
              </Button>
              <span className="text-xs text-muted-foreground">
                A legal hold protects the version until it is removed.
              </span>
            </>
          )}
        </div>
      )}

      {capabilities.version_retention && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium">Retention</span>
            {retentionPhase !== 'ready' ? (
              <InlinePhase
                phase={retentionPhase}
                error={retention.error}
                onRetry={() => void retention.refetch()}
              />
            ) : r?.event_hold === 'ON' ? (
              <StatusChip tone="warning" icon={Lock} label="Event hold on" />
            ) : active ? (
              <StatusChip
                tone="good"
                icon={Lock}
                label={`Retained, ${MODE_WORD[r?.mode ?? 'GOVERNANCE']}`}
              />
            ) : (
              <StatusChip tone="muted" icon={Circle} label="None" />
            )}
            {r?.retain_until_date && (
              <span className="text-xs text-muted-foreground">
                {active ? 'until' : 'ended'}{' '}
                <Timestamp value={r.retain_until_date} mode="absolute" />
              </span>
            )}
            {r?.retain_until_date && !active && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void clearRetention()}
              >
                Clear retention
              </Button>
            )}
          </div>
          {retentionPhase === 'ready' && (
            <form
              aria-label={`Retention for version ${id}`}
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void setRetention();
              }}
            >
              <label className={LABEL}>
                Mode
                <Select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                  <option value="GOVERNANCE">Governance</option>
                  <option value="COMPLIANCE">Compliance (cannot be undone)</option>
                </Select>
              </label>
              <label className={LABEL}>
                Retain until (UTC)
                <input
                  type="date"
                  className={FIELD}
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </label>
              <Button type="submit" size="sm" disabled={!until || Boolean(untilProblem) || busy}>
                {active ? 'Extend retention' : 'Set retention'}
              </Button>
              {untilProblem && (
                <span className="basis-full text-xs" style={{ color: 'var(--status-critical)' }}>
                  {untilProblem}
                </span>
              )}
            </form>
          )}
          {retentionPhase === 'ready' && capabilities.version_event_hold && (
            <div className="flex flex-wrap items-end gap-3">
              {r?.event_hold === 'ON' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void releaseEventHold()}
                >
                  Release event hold
                </Button>
              ) : (
                <>
                  <label className={LABEL}>
                    Event hold, then keep for
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      className={cn(FIELD, 'w-28 tabular-nums')}
                      value={holdAmount}
                      onChange={(e) => setHoldAmount(e.target.value)}
                    />
                  </label>
                  <label className={LABEL}>
                    Unit
                    <Select value={holdUnit} onChange={(e) => setHoldUnit(e.target.value as Unit)}>
                      <option value="days">days</option>
                      <option value="years">years</option>
                    </Select>
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!holdOk || busy}
                    onClick={() => void placeEventHold()}
                  >
                    Place event hold
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {op.data && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        >
          {op.data.state === 'failed' ? (
            <StatusChip tone="critical" icon={WarningTriangle} label="Failed" />
          ) : op.data.state === 'ready' ? (
            <StatusChip tone="good" icon={Lock} label="Applied" />
          ) : (
            <StatusChip tone="warning" icon={RefreshDouble} spin label="Applying" />
          )}
          <span>
            {op.data.state === 'failed'
              ? `The ${op.data.kind === 'legal_hold' ? 'legal hold' : 'retention'} change failed: ${
                  op.data.last_error_code
                    ? LAST_ERROR[op.data.last_error_code]
                    : 'storage refused it'
                }.`
              : op.data.state === 'ready'
                ? `The ${op.data.kind === 'legal_hold' ? 'legal hold' : 'retention'} change is applied.`
                : 'Applying the change to storage.'}
          </span>
        </p>
      )}
    </div>
  );
}
