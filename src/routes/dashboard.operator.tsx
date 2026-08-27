import { useMemo, useState, type ReactNode } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle, RefreshDouble, Settings, WarningTriangle } from 'iconoir-react';
import { ErrorState, LoadingState, PageHeader, Panel } from '@/components/dashboard/primitives';
import { Pill, ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  type OperatorRuntimeConfig,
  type OperatorRuntimeConfigOperation,
  type OperatorRuntimeConfigRevision,
  useOperatorRuntimeConfig,
  useOperatorRuntimeConfigOperation,
  useOperatorRuntimeConfigRevisions,
  useRollbackOperatorRuntimeConfig,
  useUpdateOperatorRuntimeConfig,
} from '@/lib/api/queries';
import { formatRelative } from '@/lib/mock-data';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/operator')({
  component: OperatorPage,
  head: () =>
    consoleHead(
      'operator',
      'Change supported control-plane settings without SSH or a service restart.'
    ),
});

const VALUE_INPUT_CLASS =
  'mt-1.5 h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-brand/50';
const TEXTAREA_CLASS =
  'mt-1.5 min-h-20 w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-brand/50';

const STATUS_COLOR: Record<OperatorRuntimeConfig['status'], string> = {
  applied: 'var(--status-good)',
  pending: 'var(--status-warning)',
  failed: 'var(--status-critical)',
  blocked: 'var(--status-critical)',
};

const APPLY_MODE_COLOR: Record<OperatorRuntimeConfig['apply_mode'], string> = {
  hot: 'var(--status-good)',
  graceful: 'var(--status-warning)',
  rolling: 'var(--brand)',
  break_glass: 'var(--status-critical)',
};

const TERMINAL_OPERATION_STATUS = new Set<OperatorRuntimeConfigOperation['status']>([
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
]);

interface ConfigRow {
  id: string;
  key: string;
  label: string;
  category: string;
  desired: string;
  effective: string;
  applyMode: OperatorRuntimeConfig['apply_mode'];
  status: OperatorRuntimeConfig['status'];
  mutable: boolean;
  version: number;
}

const EMPTY_CONFIG_ENTRIES: OperatorRuntimeConfig[] = [];

function formatWhen(value: string | undefined): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? '—' : formatRelative(timestamp);
}

function formatValue(config: OperatorRuntimeConfig, value: unknown): string {
  if (config.sensitive) return 'Redacted';
  if (value === undefined || value === null) return '—';
  if (typeof value === 'string') return value || '""';
  if (typeof value === 'object') return JSON.stringify(value) ?? '—';
  return String(value);
}

function editableValue(config: OperatorRuntimeConfig): string {
  if (config.sensitive) return '';
  const value = config.desired_value;
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return value;
  return String(value);
}

function parseValue(config: OperatorRuntimeConfig, value: string): unknown {
  switch (config.kind) {
    case 'boolean':
      return value === 'true';
    case 'integer':
      return Number(value);
    case 'duration':
    case 'string':
    case 'enum':
    case 'secret_reference':
      return value;
  }
}

function isOperation(
  value: OperatorRuntimeConfig | OperatorRuntimeConfigOperation
): value is OperatorRuntimeConfigOperation {
  return 'phase' in value && 'target_count' in value;
}

function ConfigValueInput({
  config,
  value,
  onChange,
}: {
  config: OperatorRuntimeConfig;
  value: string;
  onChange: (value: string) => void;
}) {
  if (config.kind === 'boolean') {
    return (
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={VALUE_INPUT_CLASS}
        aria-label={config.label + ' value'}
      >
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  return (
    <input
      type={config.kind === 'integer' ? 'number' : 'text'}
      step={config.kind === 'integer' ? 1 : undefined}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={VALUE_INPUT_CLASS}
      aria-label={config.label + ' value'}
    />
  );
}

function EditorModal({
  config,
  open,
  onClose,
  onOperation,
}: {
  config: OperatorRuntimeConfig | undefined;
  open: boolean;
  onClose: () => void;
  onOperation: (operationId: string) => void;
}) {
  const { toast } = useToast();
  const update = useUpdateOperatorRuntimeConfig();
  const [value, setValue] = useState(() => (config ? editableValue(config) : ''));
  const [reason, setReason] = useState('');

  if (!config) return null;

  const valueInvalid =
    config.kind === 'integer' && (value.trim() === '' || !Number.isInteger(Number(value)));
  const reasonInvalid = reason.trim().length < 3;
  const invalid = valueInvalid || reasonInvalid;

  const save = () => {
    if (invalid || update.isPending) return;

    void update
      .mutateAsync({
        key: config.key,
        value: parseValue(config, value),
        reason: reason.trim(),
        expected_version: config.version,
      })
      .then((result) => {
        if (isOperation(result)) {
          onOperation(result.id);
          toast({
            kind: 'info',
            title: 'Configuration change queued',
            description: config.label + ' is applying asynchronously.',
          });
        } else {
          toast({
            kind: 'success',
            title: 'Configuration applied',
            description: config.label + ' changed without a restart.',
          });
        }
        onClose();
      })
      .catch((error: unknown) => {
        toast({
          kind: 'error',
          title: 'Could not update configuration',
          description: errorMessage(error),
        });
      });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={'Edit ' + config.label}
      description={
        config.key + ' · version ' + config.version + ' · ' + config.apply_mode + ' apply'
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={save} disabled={invalid || update.isPending}>
            {update.isPending ? 'Applying…' : 'Apply change'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-sm font-medium">{config.description}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            The current effective value is{' '}
            <span className="font-mono text-foreground">
              {formatValue(config, config.effective_value)}
            </span>
            .
          </p>
        </div>

        <label className="block">
          <span className="label-mono text-muted-foreground">Desired value</span>
          <ConfigValueInput config={config} value={value} onChange={setValue} />
          {valueInvalid && (
            <span className="mt-1 block text-xs text-[color:var(--status-critical)]">
              Enter a whole number.
            </span>
          )}
        </label>

        <label className="block">
          <span className="label-mono text-muted-foreground">Reason</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Why is this change needed?"
            maxLength={500}
            className={TEXTAREA_CLASS}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Required for the audit trail · {reason.length}/500
          </span>
        </label>

        {config.sensitive && (
          <p className="text-xs text-muted-foreground">
            This value is sensitive. It is never displayed by the console; enter the replacement
            reference directly.
          </p>
        )}
      </div>
    </Modal>
  );
}

function DetailsModal({
  config,
  open,
  onClose,
  onEdit,
  onHistory,
}: {
  config: OperatorRuntimeConfig | undefined;
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  onHistory: () => void;
}) {
  if (!config) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={config.label}
      description={config.key + ' · ' + config.category}
      width="max-w-lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button variant="outline" size="sm" onClick={onHistory}>
            Revision history
          </Button>
          {config.mutable && (
            <Button size="sm" onClick={onEdit}>
              Edit setting
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm leading-relaxed text-muted-foreground">{config.description}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <ValueCard label="Desired" value={formatValue(config, config.desired_value)} />
          <ValueCard label="Effective" value={formatValue(config, config.effective_value)} />
          <ValueCard label="Default" value={formatValue(config, config.default_value)} />
          <ValueCard label="Version" value={String(config.version)} />
          <ValueCard label="Apply mode" value={config.apply_mode} />
          <ValueCard label="Source" value={config.source.replaceAll('_', ' ')} />
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs">
          <Pill label={config.status} color={STATUS_COLOR[config.status]} />
          {config.mutable ? (
            <Pill label="operator editable" color="var(--status-good)" />
          ) : (
            <Pill label="deployment managed" />
          )}
          {config.last_error && (
            <span className="text-[color:var(--status-critical)]">{config.last_error}</span>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          Updated {formatWhen(config.updated_at)} · Applied {formatWhen(config.applied_at)}
        </div>
      </div>
    </Modal>
  );
}

function ValueCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="label-mono text-muted-foreground">{label}</p>
      <p className="mt-1 break-all font-mono text-xs text-foreground">{value}</p>
    </div>
  );
}

function HistoryModal({
  config,
  open,
  onClose,
}: {
  config: OperatorRuntimeConfig | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [target, setTarget] = useState<OperatorRuntimeConfigRevision | null>(null);
  const [reason, setReason] = useState('');
  const revisions = useOperatorRuntimeConfigRevisions(config?.key ?? '');
  const rollback = useRollbackOperatorRuntimeConfig();

  if (!config) return null;

  const confirmRollback = () => {
    if (!target || reason.trim().length < 3 || rollback.isPending) return;

    void rollback
      .mutateAsync({
        key: config.key,
        version: target.version,
        reason: reason.trim(),
        expected_version: config.version,
      })
      .then(() => {
        toast({
          kind: 'success',
          title: 'Configuration rolled back',
          description: config.label + ' is now on revision ' + target.version + '.',
        });
        setTarget(null);
        setReason('');
        onClose();
      })
      .catch((error: unknown) => {
        toast({
          kind: 'error',
          title: 'Could not roll back configuration',
          description: errorMessage(error),
        });
      });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={config.label + ' history'}
      description="Revisions are append-only. A rollback creates a new revision and uses optimistic concurrency."
      width="max-w-3xl"
      footer={
        target ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setTarget(null)}
              disabled={rollback.isPending}
            >
              Back
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={confirmRollback}
              disabled={reason.trim().length < 3 || rollback.isPending}
            >
              {rollback.isPending ? 'Rolling back…' : 'Roll back to v' + target.version}
            </Button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      {target ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-[color:color-mix(in_oklab,var(--status-warning)_35%,transparent)] bg-[color:color-mix(in_oklab,var(--status-warning)_8%,transparent)] p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <WarningTriangle className="h-4 w-4" style={{ color: 'var(--status-warning)' }} />
              Confirm rollback to revision {target.version}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              The selected historical value will be applied as a new version. The current version is{' '}
              {config.version}; the server will reject this if somebody changes it first.
            </p>
          </div>
          <ValueCard label="Selected value" value={formatValue(config, target.new_value)} />
          <label className="block">
            <span className="label-mono text-muted-foreground">Reason</span>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why should this revision be restored?"
              maxLength={500}
              className={TEXTAREA_CLASS}
            />
          </label>
        </div>
      ) : revisions.error ? (
        <ErrorState error={revisions.error} onRetry={() => void revisions.refetch()} />
      ) : revisions.isPending ? (
        <LoadingState message="Loading revision history…" />
      ) : revisions.data?.items.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[650px] text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="label-mono px-3 py-2.5 text-muted-foreground">Version</th>
                <th className="label-mono px-3 py-2.5 text-muted-foreground">Change</th>
                <th className="label-mono px-3 py-2.5 text-muted-foreground">Reason</th>
                <th className="label-mono px-3 py-2.5 text-muted-foreground">When</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {revisions.data.items.map((revision) => (
                <tr key={revision.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-3 align-top font-mono text-xs">
                    <span className="flex items-center gap-2">
                      v{revision.version}
                      {revision.version === config.version && (
                        <Pill label="current" color="var(--status-good)" />
                      )}
                    </span>
                  </td>
                  <td className="max-w-40 break-all px-3 py-3 align-top font-mono text-xs">
                    {formatValue(config, revision.new_value)}
                  </td>
                  <td className="max-w-56 px-3 py-3 align-top text-xs text-muted-foreground">
                    {revision.reason}
                  </td>
                  <td className="px-3 py-3 align-top text-xs text-muted-foreground">
                    {formatWhen(revision.created_at)}
                  </td>
                  <td className="px-3 py-3 text-right align-top">
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!config.mutable || revision.version === config.version}
                      onClick={() => setTarget(revision)}
                    >
                      Roll back
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
          No revisions recorded for this setting.
        </p>
      )}
    </Modal>
  );
}

function OperationBanner({ id, onDismiss }: { id: string; onDismiss: () => void }) {
  const operation = useOperatorRuntimeConfigOperation(id);
  const data = operation.data;
  const terminal = data ? TERMINAL_OPERATION_STATUS.has(data.status) : false;

  return (
    <Panel
      title="Configuration operation"
      description={data ? data.key + ' · operation ' + data.id : 'Loading operation status…'}
      actions={
        <Button size="xs" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    >
      {operation.error ? (
        <ErrorState error={operation.error} onRetry={() => void operation.refetch()} />
      ) : operation.isPending ? (
        <LoadingState message="Waiting for the controller…" />
      ) : data ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Pill
              label={data.status}
              color={
                terminal
                  ? data.status === 'succeeded'
                    ? 'var(--status-good)'
                    : 'var(--status-critical)'
                  : 'var(--status-warning)'
              }
            />
            <span className="text-sm text-muted-foreground">{data.phase}</span>
          </div>
          <div className="grid gap-3 text-xs sm:grid-cols-3">
            <ValueCard label="Target nodes" value={String(data.target_count)} />
            <ValueCard label="Applied" value={String(data.applied_count)} />
            <ValueCard label="Failed" value={String(data.failed_count)} />
          </div>
          {data.error && (
            <p className="text-sm text-[color:var(--status-critical)]">{data.error}</p>
          )}
          {!terminal && (
            <p className="text-xs text-muted-foreground">
              This panel refreshes every two seconds until the controller reports a terminal state.
            </p>
          )}
        </div>
      ) : null}
    </Panel>
  );
}

function OperatorPage() {
  const { data, isPending, error, refetch } = useOperatorRuntimeConfig();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);

  const entries = data?.items ?? EMPTY_CONFIG_ENTRIES;
  const selected = entries.find((entry) => entry.key === selectedKey);
  const editing = entries.find((entry) => entry.key === editingKey);
  const history = entries.find((entry) => entry.key === historyKey);

  const rows = useMemo<ConfigRow[]>(
    () =>
      entries.map((entry) => ({
        id: entry.key,
        key: entry.key,
        label: entry.label,
        category: entry.category,
        desired: formatValue(entry, entry.desired_value),
        effective: formatValue(entry, entry.effective_value),
        applyMode: entry.apply_mode,
        status: entry.status,
        mutable: entry.mutable,
        version: entry.version,
      })),
    [entries]
  );

  const columns: Column<ConfigRow>[] = [
    {
      key: 'label',
      label: 'Setting',
      render: (row) => (
        <div className="min-w-48">
          <p className="font-medium">{row.label}</p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{row.key}</p>
        </div>
      ),
    },
    {
      key: 'category',
      label: 'Category',
      render: (row) => <span className="text-xs text-muted-foreground">{row.category}</span>,
    },
    {
      key: 'desired',
      label: 'Desired',
      render: (row) => <span className="max-w-48 break-all font-mono text-xs">{row.desired}</span>,
    },
    {
      key: 'effective',
      label: 'Effective',
      render: (row) => (
        <span className="max-w-48 break-all font-mono text-xs">{row.effective}</span>
      ),
    },
    {
      key: 'applyMode',
      label: 'Apply',
      render: (row) => <Pill label={row.applyMode} color={APPLY_MODE_COLOR[row.applyMode]} />,
    },
    {
      key: 'status',
      label: 'Status',
      render: (row) => <Pill label={row.status} color={STATUS_COLOR[row.status]} />,
    },
    {
      key: 'version',
      label: 'Version',
      numeric: true,
      render: (row) => <span className="font-mono text-xs">v{row.version}</span>,
    },
    {
      key: 'mutable',
      label: 'Action',
      sortable: false,
      render: (row) => (
        <Button
          size="xs"
          variant="outline"
          disabled={!row.mutable}
          onClick={(event) => {
            event.stopPropagation();
            setEditingKey(row.key);
          }}
        >
          {row.mutable ? 'Edit' : 'Managed'}
        </Button>
      ),
    },
  ];

  const accessDenied = error instanceof ApiError && error.isForbidden;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Runtime configuration"
        description="Operator-only control-plane settings with audited, versioned changes and no SSH session."
        actions={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => void refetch()}
            disabled={isPending}
          >
            <RefreshDouble className={isPending ? 'animate-spin' : undefined} />
            Refresh
          </Button>
        }
      />

      {operationId && <OperationBanner id={operationId} onDismiss={() => setOperationId(null)} />}

      {accessDenied ? (
        <Panel title="Operator access required" lit>
          <div className="flex items-start gap-3">
            <WarningTriangle
              className="mt-0.5 h-5 w-5 shrink-0"
              style={{ color: 'var(--status-warning)' }}
            />
            <div>
              <p className="text-sm font-medium">
                This surface is restricted to platform operators.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Your session is valid, but it does not have permission to read the runtime
                configuration catalog.
              </p>
            </div>
          </div>
        </Panel>
      ) : error ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : isPending ? (
        <LoadingState message="Loading runtime configuration…" />
      ) : (
        <Panel
          title="Control-plane catalog"
          description={
            entries.length +
            ' setting' +
            (entries.length === 1 ? '' : 's') +
            ' · values marked redacted never leave the API in plaintext'
          }
          lit
          padded={false}
        >
          <div className="p-5">
            <ResourceTable
              rows={rows}
              columns={columns}
              initialSort={{ key: 'label', dir: 'asc' }}
              searchKeys={[
                'key',
                'label',
                'category',
                'desired',
                'effective',
                'applyMode',
                'status',
              ]}
              searchPlaceholder="Filter by setting, category, or status…"
              emptyMessage="The operator catalog is empty."
              minWidth="min-w-[1250px]"
              onRowClick={(row) => setSelectedKey(row.key)}
            />
          </div>
        </Panel>
      )}

      <Panel
        title="Change model"
        description="The API controls how each setting reaches the fleet."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <ModelCard
            icon={<CheckCircle className="h-4 w-4" style={{ color: 'var(--status-good)' }} />}
            title="Hot"
            text="Applied immediately through the live runtime-config path. No process restart."
          />
          <ModelCard
            icon={<RefreshDouble className="h-4 w-4" style={{ color: 'var(--status-warning)' }} />}
            title="Graceful or rolling"
            text="Returns a durable operation that this page polls until the controller finishes."
          />
          <ModelCard
            icon={<Settings className="h-4 w-4 text-muted-foreground" />}
            title="Deployment managed"
            text="Bootstrap and break-glass values stay visible for diagnosis but are not editable here."
          />
        </div>
      </Panel>

      <DetailsModal
        config={selected}
        open={Boolean(selected)}
        onClose={() => setSelectedKey(null)}
        onEdit={() => {
          setEditingKey(selectedKey);
          setSelectedKey(null);
        }}
        onHistory={() => {
          setHistoryKey(selectedKey);
          setSelectedKey(null);
        }}
      />
      <EditorModal
        key={editingKey ?? 'editor-closed'}
        config={editing}
        open={Boolean(editing)}
        onClose={() => setEditingKey(null)}
        onOperation={setOperationId}
      />
      <HistoryModal
        key={historyKey ?? 'history-closed'}
        config={history}
        open={Boolean(history)}
        onClose={() => setHistoryKey(null)}
      />
    </div>
  );
}

function ModelCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  );
}
