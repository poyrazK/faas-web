import { Panel } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useTrigger } from '@/lib/api/queries';

/**
 * One trigger's configuration, under the counts the list already shows.
 *
 * Editing stays in `gregale.yaml` and the CLI — a trigger's source, filter
 * and target belong in version control — but reading what is actually
 * deployed does not, and "why is nothing arriving" is usually answered by
 * the filter or the paused flag rather than by the record log.
 */

function fieldRows(trigger: Record<string, unknown>): [string, string][] {
  const rows: [string, string][] = [];
  const add = (label: string, value: unknown) => {
    if (value === undefined || value === null || value === '') return;
    rows.push([label, typeof value === 'string' ? value : JSON.stringify(value)]);
  };
  add('Source', trigger.source);
  add('Target', trigger.target ?? trigger.app_slug);
  add('Filter', trigger.filter);
  add('Batch size', trigger.batch_size);
  add('Max retries', trigger.max_retries);
  add('Created', trigger.created_at ? new Date(String(trigger.created_at)).toLocaleString() : null);
  add('Updated', trigger.updated_at ? new Date(String(trigger.updated_at)).toLocaleString() : null);
  return rows;
}

export function TriggerConfiguration({ triggerId }: { triggerId: string }) {
  const trigger = useTrigger(triggerId);
  const data = trigger.data as Record<string, unknown> | undefined;
  const missing = trigger.error instanceof ApiError && trigger.error.status === 404;

  if (trigger.isPending)
    return <p className="text-sm text-muted-foreground">Reading the trigger…</p>;
  if (missing)
    return <p className="text-sm text-muted-foreground">This trigger no longer exists.</p>;
  if (trigger.error || !data)
    return <p className="text-sm text-muted-foreground">{errorMessage(trigger.error)}</p>;

  const rows = fieldRows(data);
  return (
    <Panel
      title="Configuration"
      description="As deployed. Triggers are defined in gregale.yaml and changed through the CLI."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill label={String(data.kind ?? 'trigger')} />
          <Pill
            label={data.enabled === false ? 'paused' : 'enabled'}
            color={data.enabled === false ? 'var(--status-idle)' : 'var(--status-good)'}
          />
          <span className="font-mono text-xs text-muted-foreground">
            {String(data.id ?? triggerId)}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            The API returned no configurable fields for this trigger.
          </p>
        ) : (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-0.5">
                <dt className="label-mono text-muted-foreground">{label}</dt>
                <dd className="truncate font-mono text-xs" title={value}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </Panel>
  );
}
