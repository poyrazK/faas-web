import { useEffect, useRef, useState } from 'react';
import { CheckCircle, RefreshDouble } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyableId } from '@/components/ui/copyable-id';
import { Select } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { useCapabilityAccess, useCapabilityStage } from '@/lib/api/capabilities';
import { ApiError } from '@/lib/api/errors';
import {
  useChangePostgresComputePolicy,
  usePostgresCapabilities,
  usePostgresComputePolicyChange,
  usePostgresResize,
  useResizePostgresDatabase,
  type PostgresComputePolicyChange,
  type PostgresResize,
  type PostgresServiceClass,
} from '@/lib/api/postgres';
import type { PostgresDatabase } from '@/lib/api/queries';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { StageTag, StatusTag, explainPostgres } from './postgres-shared';

/**
 * Resize and the scale-to-zero compute policy (capability
 * `postgres-compute-policy`, beta; faas docs/postgres.md § Change the compute
 * class, handlers_managed_postgres_compute_policy.go, managedpg/resize.go).
 *
 * Both reserve a durable change keyed by a UUID the console picks. A retry
 * after an unknown outcome reuses it, so it recovers the same change rather
 * than starting a second; after a refusal the answer is known and the next
 * try gets a new one. Only a ready database can change, one change at a time,
 * and clients may be disconnected while it happens. There is no list of a
 * database's changes, so the page follows the one it started, by id, until
 * it reports `succeeded`; a pending change with a `last_error_code` is one
 * apid is still retrying, not a failure.
 *
 * What is offered comes from the capabilities route for the database's
 * region: the classes the plan includes, whether the backend resizes, and
 * whether always-on compute is in the plan (no current plan includes it, so
 * turning scale-to-zero off is shown, disabled, with the reason).
 */

export type ComputeOperation = { kind: 'resize' | 'policy'; id: string };

const CLASSES: PostgresServiceClass[] = ['development', 'burstable', 'production'];
const title = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);
const policyWords = (scaleToZero: boolean) => (scaleToZero ? 'scales to zero' : 'always on');

function explainCompute(err: unknown): ReturnType<typeof explainPostgres> {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'managed_postgres_conflict':
        return {
          kind: 'error',
          title: 'Another change is in progress',
          description:
            'A resize, policy change, deletion, binding change or restore holds this database. Wait until it is ready, then try again.',
          error: err,
        };
      case 'managed_postgres_unsupported':
        return {
          kind: 'error',
          title: 'Not supported for this database',
          description: 'Its backend cannot make this change, for example on a published clone.',
          error: err,
        };
    }
  }
  return explainPostgres(err);
}

export function DatabaseCompute({
  database,
  operation,
  onOperation,
}: {
  database: PostgresDatabase;
  /** The change this page started for the database, followed until it settles. */
  operation?: ComputeOperation;
  onOperation: (operation: ComputeOperation) => void;
}) {
  const { org, label } = useWorkspaceTarget();
  const plan = org ? `${label}'s plan` : 'your plan';
  const { access } = useCapabilityAccess('postgres-compute-policy');
  const stage = useCapabilityStage('postgres-compute-policy');
  const capabilities = usePostgresCapabilities(access === 'on' ? database.region : undefined);
  const resize = useResizePostgresDatabase();
  const policy = useChangePostgresComputePolicy();
  const resizeProgress = usePostgresResize(
    database.id,
    access === 'on' && operation?.kind === 'resize' ? operation.id : ''
  );
  const policyProgress = usePostgresComputePolicyChange(
    database.id,
    access === 'on' && operation?.kind === 'policy' ? operation.id : ''
  );
  const confirm = useConfirm();
  const { toast } = useToast();
  const [target, setTarget] = useState<PostgresServiceClass>(database.service_class);
  // One request id per intent (kind and target), kept only while the outcome is unknown.
  const intents = useRef(new Map<string, string>());

  const kind = operation?.kind;
  const resized = kind === 'resize' ? resizeProgress.data : undefined;
  const changed = kind === 'policy' ? policyProgress.data : undefined;
  const followed: Followed | undefined = resized
    ? { kind: 'resize', change: resized }
    : changed
      ? { kind: 'policy', change: changed }
      : undefined;
  const pending = followed?.change.state === 'pending';

  // Said once, when the followed change settles.
  const settled = useRef<string | null>(null);
  useEffect(() => {
    const done = resized ?? changed;
    if (!done || done.state !== 'succeeded' || settled.current === done.id) return;
    settled.current = done.id;
    toast({
      kind: 'success',
      title: resized
        ? `${database.name} is now ${resized.target_class}`
        : `${database.name} now ${changed?.target_scale_to_zero ? 'scales to zero when idle' : 'stays always on'}`,
    });
  }, [resized, changed, database.name, toast]);

  if (access !== 'on') return null;

  const caps = capabilities.data;
  const included = caps?.service_classes ?? [];
  const current = database.service_class;
  const options = CLASSES.filter((c) => c === current || included.includes(c));
  const others = included.filter((c) => c !== current);
  const isReady = database.state === 'ready';

  let resizeNote: string | null = null;
  if (caps && others.length === 0)
    resizeNote = `${title(plan)} includes only the ${current} class. Upgrade to resize.`;
  else if (caps && !caps.class_resize && included.includes(current))
    resizeNote = `The backend cannot resize databases in ${caps.region}.`;
  else if (!isReady && !pending) resizeNote = 'Resize once the database is ready.';
  const canResize = Boolean(caps) && !resizeNote && isReady && !pending;

  const policySupported = Boolean(caps?.scale_to_zero_update);
  const turningOff = database.scale_to_zero;
  let policyNote: string | null = null;
  if (caps && !policySupported)
    policyNote = `Changing scale to zero is not supported in ${caps.region}.`;
  else if (caps && turningOff && !caps.always_on)
    policyNote = `Always-on compute is not part of ${plan}, so compute keeps suspending when the database is idle.`;
  const canChangePolicy = Boolean(caps) && !policyNote && isReady && !pending;

  const start = async (
    kind: 'resize' | 'policy',
    intent: string,
    send: (id: string) => Promise<{ id: string }>
  ) => {
    const key = `${kind}:${intent}`;
    const requestId = intents.current.get(key) ?? crypto.randomUUID();
    intents.current.set(key, requestId);
    try {
      const accepted = await send(requestId);
      intents.current.delete(key);
      onOperation({ kind, id: accepted.id });
      return true;
    } catch (err) {
      if (err instanceof ApiError) intents.current.delete(key);
      toast(explainCompute(err));
      return false;
    }
  };

  const onResize = async () => {
    if (
      !(await confirm({
        title: `Resize ${database.name} to ${target}?`,
        description:
          "The provider changes the database's compute class. Clients may be disconnected during the change and reconnect with the same credentials. Region, version, storage and the restore window stay as they are.",
        confirmLabel: 'Resize',
      }))
    )
      return;
    const ok = await start('resize', target, (requestId) =>
      resize.mutateAsync({ id: database.id, request_id: requestId, service_class: target })
    );
    if (ok)
      toast({
        kind: 'info',
        title: 'Resize accepted',
        description: `${database.name} is moving from ${current} to ${target}. It is not finished until it reports succeeded.`,
      });
  };

  const onPolicy = async () => {
    const scaleToZero = !database.scale_to_zero;
    if (
      !(await confirm(
        scaleToZero
          ? {
              title: `Turn scale to zero on for ${database.name}?`,
              description:
                'Compute suspends when the database is idle and the next connection wakes it, which delays that connection briefly. Clients may be disconnected during the change.',
              confirmLabel: 'Turn scale to zero on',
            }
          : {
              title: `Keep ${database.name} always on?`,
              description:
                'Compute stops suspending when the database is idle, so it uses compute around the clock and reaches the monthly allowance sooner. Clients may be disconnected during the change.',
              confirmLabel: 'Keep it always on',
            }
      ))
    )
      return;
    const ok = await start('policy', String(scaleToZero), (requestId) =>
      policy.mutateAsync({ id: database.id, request_id: requestId, scale_to_zero: scaleToZero })
    );
    if (ok)
      toast({
        kind: 'info',
        title: 'Policy change accepted',
        description: `${database.name} is changing to ${policyWords(scaleToZero)}.`,
      });
  };

  return (
    <section aria-label="Compute" className="flex flex-col gap-3">
      <p className="flex items-center gap-2 label-mono text-muted-foreground">
        Compute <StageTag stage={stage} />
      </p>
      <p className="text-sm text-muted-foreground">
        {title(current)} class · {database.scale_to_zero ? 'scales to zero when idle' : 'always on'}
        . Clients may be disconnected during a change and reconnect with the same credentials.
      </p>
      {followed && <Progress followed={followed} />}
      {caps ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Compute class</span>
                <Select
                  value={target}
                  onChange={(e) => setTarget(e.target.value as PostgresServiceClass)}
                  aria-label="Target compute class"
                  disabled={!canResize}
                  className="h-8 text-xs"
                >
                  {options.map((c) => (
                    <option key={c} value={c}>
                      {title(c)}
                      {c === current
                        ? included.includes(c)
                          ? ' (current)'
                          : ' (current, not in plan)'
                        : ''}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={!canResize || target === current}
                busy={resize.isPending}
                onClick={() => void onResize()}
              >
                Resize
              </Button>
            </div>
            {resizeNote && <p className="text-xs text-muted-foreground">{resizeNote}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!canChangePolicy}
                busy={policy.isPending}
                onClick={() => void onPolicy()}
              >
                {database.scale_to_zero ? 'Keep it always on' : 'Turn scale to zero on'}
              </Button>
            </div>
            {policyNote && <p className="text-xs text-muted-foreground">{policyNote}</p>}
          </div>
        </div>
      ) : (
        <InlinePhase
          phase={queryPhase({ error: capabilities.error, loading: capabilities.isPending })}
          error={capabilities.error}
          loadingMessage="Reading what the plan allows…"
          onRetry={() => void capabilities.refetch()}
        />
      )}
    </section>
  );
}

type Followed =
  | { kind: 'resize'; change: PostgresResize }
  | { kind: 'policy'; change: PostgresComputePolicyChange };

function Progress({ followed }: { followed: Followed }) {
  const { change } = followed;
  const done = change.state === 'succeeded';
  const resize = followed.kind === 'resize';
  const route =
    followed.kind === 'resize'
      ? `${followed.change.from_class} → ${followed.change.target_class}`
      : `${policyWords(followed.change.from_scale_to_zero)} → ${policyWords(followed.change.target_scale_to_zero)}`;
  return (
    <div className="flex flex-col gap-1.5 text-xs text-muted-foreground" role="status">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusTag tone={done ? 'good' : 'warning'} icon={done ? CheckCircle : RefreshDouble}>
          {done
            ? resize
              ? 'Resized'
              : 'Policy changed'
            : resize
              ? 'Resizing'
              : 'Changing compute policy'}
        </StatusTag>
        <span>{route}</span>
        <span>
          {done ? (
            <>
              finished <Timestamp value={change.completed_at} />
            </>
          ) : (
            <>
              started <Timestamp value={change.created_at} />
            </>
          )}
        </span>
      </p>
      {!done && change.last_error_code && (
        <p className="flex flex-wrap items-baseline gap-x-2">
          The provider has not confirmed it yet; apid keeps retrying.
          <code className="font-mono">{change.last_error_code}</code>
        </p>
      )}
      <p className="flex flex-wrap items-center gap-2">
        <span>Request ID</span>
        <CopyableId value={change.id} label="request ID" full />
      </p>
    </div>
  );
}
