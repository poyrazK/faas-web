import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, EditPencil, Pause, Play, Trash } from 'iconoir-react';
import type { Account } from '@/lib/auth';
import type { App, Trigger } from '@/lib/api/queries';
import {
  useDeleteTrigger,
  useSetTriggerEnabled,
  useTrigger,
  useTriggerMetrics,
  useUpdateTrigger,
} from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/field';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Panel,
  StatTile,
} from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { TriggerRecords } from './trigger-records';
import { TriggerDeadLetter } from './trigger-dlq';
import { TriggerSourceFields } from './trigger-source-fields';
import { TriggerDeliveryFields } from './trigger-delivery-fields';
import {
  buildUpdateTriggerRequest,
  clearTriggerSecrets,
  draftFromTrigger,
  validateTriggerDraft,
  type TriggerDraft,
} from './trigger-form-model';

function sourceRows(draft: TriggerDraft): Array<[string, string]> {
  const source = draft.source;
  if (source.kind === 'kafka') {
    return [
      ['Brokers', source.brokers],
      ['Topic', source.topic],
      ['Consumer group', source.group],
      ...(source.tlsEnabled ? ([['TLS', 'Enabled']] as Array<[string, string]>) : []),
      ...(source.clientKeySet
        ? ([['Client key', 'Client key configured']] as Array<[string, string]>)
        : []),
      ...(source.saslEnabled
        ? ([
            ['SASL mechanism', source.mechanism],
            ['SASL username', source.username],
          ] as Array<[string, string]>)
        : []),
      ...(source.passwordSet
        ? ([['SASL password', 'Password configured']] as Array<[string, string]>)
        : []),
    ];
  }
  if (source.kind === 'nats') {
    return [
      ['URL', source.url],
      ['Stream', source.stream],
      ['Subject', source.subject],
      ['Durable', source.durable],
    ];
  }
  if (source.kind === 'redis_streams') {
    return [
      ['Address', source.addr],
      ['Stream', source.stream],
      ['Consumer group', source.group],
    ];
  }
  if (source.kind === 'sqs_compat') {
    return [
      ['Queue URL', source.queueUrl],
      ...(source.longPollSecs
        ? ([['Long poll', `${source.longPollSecs} s`]] as Array<[string, string]>)
        : []),
    ];
  }
  return [['Mode', source.mode]];
}

export function TriggerDetail({
  triggerId,
  account,
  apps,
}: {
  triggerId: string;
  account: Account;
  apps: App[];
}) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { toast } = useToast();
  const query = useTrigger(triggerId);
  const metrics = useTriggerMetrics(triggerId);
  const update = useUpdateTrigger();
  const remove = useDeleteTrigger();
  const setEnabled = useSetTriggerEnabled();
  const [tab, setTab] = useState<'records' | 'dlq'>('records');
  const [edit, setEdit] = useState<TriggerDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mutationError, setMutationError] = useState<string | null>(null);

  if (query.isPending) return <LoadingState message="Reading the trigger…" />;
  if (query.error instanceof ApiError && query.error.code === 'trigger_not_found') {
    return <EmptyState message="This trigger no longer exists or has been deleted." />;
  }
  if (query.error || !query.data) return <ErrorState error={query.error} />;

  const trigger = query.data;
  const draft = draftFromTrigger(trigger, account.limits);
  const destination = apps.find((app) => app.id === trigger.app_id)?.slug ?? trigger.app_id;
  const counters = metrics.data;

  const toggle = () =>
    void setEnabled
      .mutateAsync({ id: trigger.id, enabled: !trigger.enabled })
      .then(() =>
        toast({ kind: 'success', title: trigger.enabled ? 'Trigger paused' : 'Trigger resumed' })
      )
      .catch((error: unknown) => setMutationError(errorMessage(error)));

  const save = async () => {
    if (!edit) return;
    const nextErrors = validateTriggerDraft(edit);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setMutationError(null);
    try {
      await update.mutateAsync({ id: trigger.id, body: buildUpdateTriggerRequest(edit, trigger) });
      setEdit(clearTriggerSecrets(edit));
      setEdit(null);
      toast({ kind: 'success', title: 'Trigger updated' });
    } catch (error) {
      const detail = error instanceof ApiError && error.detail ? ` ${error.detail}` : '';
      setMutationError(`The trigger could not be updated.${detail}`);
    }
  };

  const destroy = async () => {
    if (
      !(await confirm({
        title: `Delete ${trigger.slug}?`,
        description: 'Polling stops and this trigger cannot be recovered.',
        confirmLabel: 'Delete trigger',
        destructive: true,
        typeToConfirm: trigger.slug ?? trigger.id,
      }))
    )
      return;
    try {
      await remove.mutateAsync(trigger.id);
      await navigate({ to: '/dashboard/triggers' });
    } catch (error) {
      setMutationError(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/dashboard/triggers"
        className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft /> All triggers
      </Link>
      <PageHeader
        title={trigger.slug ?? trigger.kind}
        description={`${trigger.kind} · ${destination} · updated ${new Date(trigger.updated_at).toLocaleString()}`}
        actions={
          <>
            <Pill
              label={trigger.enabled ? 'enabled' : 'paused'}
              color={trigger.enabled ? 'var(--status-good)' : 'var(--status-idle)'}
            />
            <Button variant="secondary" size="sm" busy={setEnabled.isPending} onClick={toggle}>
              {trigger.enabled ? <Pause /> : <Play />}
              {trigger.enabled ? 'Pause' : 'Resume'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setErrors({});
                setEdit(draft);
              }}
            >
              <EditPencil /> Edit
            </Button>
            <Button variant="destructive" size="sm" busy={remove.isPending} onClick={destroy}>
              <Trash /> Delete
            </Button>
          </>
        }
      />

      {mutationError && (
        <div role="alert" className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
          {mutationError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
        {(['pending', 'claimed', 'succeeded', 'retry', 'dead_letter'] as const).map((state) => (
          <StatTile
            key={state}
            label={state.replace('_', ' ')}
            value={counters ? counters[`${state}_count`] : undefined}
            state={
              metrics.isPending ? 'loading' : metrics.error || !counters ? 'unavailable' : 'ready'
            }
          />
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
        <Panel
          title="Source and delivery"
          description="The effective configuration currently polled by the platform."
        >
          <dl className="grid gap-4 sm:grid-cols-2">
            {[
              ...sourceRows(draft),
              ['Maximum batch', String(trigger.batch_size_max)],
              ['Batch window', `${trigger.batch_window_ms} ms`],
              ['Maximum attempts', String(trigger.max_attempts)],
              ['Payload cap', `${trigger.payload_max_bytes} bytes`],
              ...(trigger.kind === 'kafka'
                ? ([['Poison strategy', trigger.broker_poison_strategy]] as Array<[string, string]>)
                : []),
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="label-mono text-muted-foreground">{label}</dt>
                <dd className="mt-1 truncate font-mono text-xs" title={value}>
                  {value || '—'}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 border-t border-border pt-4">
            <p className="label-mono text-muted-foreground">Filter criteria</p>
            <pre className="mt-2 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
              {trigger.filter_criteria
                ? JSON.stringify(trigger.filter_criteria, null, 2)
                : 'Every record is dispatched.'}
            </pre>
          </div>
        </Panel>

        <Panel
          title="Handler contract"
          description="The route and partial-batch response your destination implements."
        >
          <code className="font-mono text-xs text-brand">
            POST /_triggers/{trigger.kind}/{trigger.slug}
          </code>
          <pre className="mt-4 overflow-auto rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
            {'{\n  "batchItemFailures": [\n    { "itemIdentifier": "record-id" }\n  ]\n}'}
          </pre>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            Missing or empty failures mean full success. Failed items retry, then enter dead letter.
          </p>
        </Panel>
      </div>

      {edit && (
        <Panel
          title="Edit trigger"
          description="Destination, source kind, and slug are immutable. Blank secret inputs preserve configured credentials."
        >
          <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (!update.isPending) void save();
            }}
          >
            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                Destination app
                <Input disabled aria-label="Destination app" value={destination} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                Trigger kind
                <Select disabled aria-label="Trigger kind" value={trigger.kind}>
                  <option>{trigger.kind}</option>
                </Select>
              </label>
              <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                Trigger slug
                <Input disabled aria-label="Trigger slug" value={trigger.slug ?? ''} />
              </label>
            </div>
            <TriggerSourceFields
              source={edit.source}
              errors={errors}
              limits={account.limits}
              onChange={(source) => setEdit((value) => value && { ...value, source })}
            />
            <TriggerDeliveryFields
              sourceKind={edit.source.kind}
              delivery={edit.delivery}
              filterCriteriaText={edit.filterCriteriaText}
              errors={errors}
              limits={account.limits}
              onDeliveryChange={(delivery) => setEdit((value) => value && { ...value, delivery })}
              onFilterChange={(filterCriteriaText) =>
                setEdit((value) => value && { ...value, filterCriteriaText })
              }
            />
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="ghost" size="sm" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" busy={update.isPending}>
                Save changes
              </Button>
            </div>
          </form>
        </Panel>
      )}

      <Panel
        title="Record activity"
        description="Inspect delivery outcomes and recover individual failures."
      >
        <div className="mb-4 flex gap-2" role="tablist" aria-label="Trigger activity">
          <Button
            size="xs"
            variant={tab === 'records' ? 'default' : 'secondary'}
            onClick={() => setTab('records')}
          >
            Records
          </Button>
          <Button
            size="xs"
            variant={tab === 'dlq' ? 'default' : 'secondary'}
            onClick={() => setTab('dlq')}
          >
            Dead letter
          </Button>
        </div>
        {tab === 'records' ? (
          <TriggerRecords triggerId={triggerId} />
        ) : (
          <TriggerDeadLetter triggerId={triggerId} />
        )}
      </Panel>
    </div>
  );
}

export type { Trigger };
