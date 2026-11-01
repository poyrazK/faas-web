import { useState } from 'react';
import { Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useLogDrainKinds, useLogDrainStage } from '@/lib/api/log-drain-capabilities';
import { useCreateLogDrain, useLogDrains, type LogDrain } from '@/lib/api/log-drains';
import { LogDrainDetail } from './log-drain-detail';
import {
  LogDrainFields,
  LogDrainProblem,
  createBody,
  draftErrors,
  emptyDraft,
  kindLabel,
} from './log-drain-form';
import { PlanGated } from './plan-gated';
import { Panel } from './primitives';
import { Pill, ResourceTable, type Column } from './resource-table';

/**
 * Where this app's runtime logs go besides the console: an HTTP endpoint that
 * takes JSON lines, an OTLP collector, or Datadog where the account has it.
 * Credentials are write-only — sealed at rest, shown back only masked — and
 * every destination reports its own delivery health and hourly delivery
 * history. Log drains are beta; the stage comes from the capability registry.
 */
export function LogDrainsBody({ slug }: { slug: string }) {
  const drains = useLogDrains(slug);
  const kinds = useLogDrainKinds();
  const stage = useLogDrainStage();
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const rows = drains.data ?? [];
  const columns: Column<LogDrain>[] = [
    {
      key: 'target_url',
      label: 'Destination',
      render: (d) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-mono text-xs">{d.target_url}</span>
          <span className="text-xs text-muted-foreground">
            {kindLabel(d)}
            {d.auth_header_masked &&
              (d.kind === 'datadog' ? ' · API key set' : ' · auth header set')}
          </span>
        </span>
      ),
    },
    {
      key: 'enabled',
      label: 'Status',
      width: 'w-28',
      render: (d) => (
        <Pill
          label={d.enabled ? 'enabled' : 'paused'}
          color={d.enabled ? 'var(--status-good)' : undefined}
        />
      ),
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      <PlanGated error={drains.error} feature="Log drains">
        <Panel
          title="Log drains"
          description={`${stage ? `${stage} · ` : ''}Send this app's runtime logs to your own HTTP endpoint${kinds.includes('datadog') ? ', an OpenTelemetry collector, or Datadog' : ' or OpenTelemetry collector'}.`}
          actions={
            <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" />
              Add destination
            </Button>
          }
          padded={false}
        >
          <ResourceTable
            rows={rows}
            columns={columns}
            emptyMessage="No log destinations yet. Logs stay in the console until you add one."
            loading={drains.isPending}
            error={drains.error}
            onRetry={() => void drains.refetch()}
            onRowClick={(d) => setSelected(d.id)}
          />
        </Panel>
      </PlanGated>
      {selected && rows.some((d) => d.id === selected) && (
        <LogDrainDetail
          slug={slug}
          drain={rows.find((d) => d.id === selected)!}
          onClose={() => setSelected(null)}
        />
      )}
      {adding && <AddLogDrain slug={slug} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddLogDrain({ slug, onClose }: { slug: string; onClose: () => void }) {
  const create = useCreateLogDrain(slug);
  const kinds = useLogDrainKinds();
  const { toast } = useToast();
  const [draft, setDraft] = useState(emptyDraft);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setAttempted(true);
    if (Object.keys(draftErrors(draft)).length) return;
    setError(null);
    try {
      await create.mutateAsync(createBody(draft));
      toast({ kind: 'success', title: 'Log destination added' });
      onClose();
    } catch (err) {
      // In the dialog, not a toast: the fields stay to fix (a URL apid refuses,
      // a quota to free up) without typing a credential again.
      setError(err);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Add a log destination"
      description="Runtime logs from every instance are delivered with retries; failures show in the destination's health."
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" busy={create.isPending} onClick={() => void submit()}>
            Add destination
          </Button>
        </>
      }
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <LogDrainFields draft={draft} onChange={setDraft} kinds={kinds} attempted={attempted} />
        <LogDrainProblem error={error} />
      </form>
    </Modal>
  );
}
