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
 * the filter criteria or the paused flag rather than by the record log.
 *
 * The fields are the schema's own: `config` holds the broker coordinates and
 * differs per kind, so it is rendered as the JSON the API returned rather
 * than flattened into invented field names.
 */

function labelled(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function TriggerConfiguration({ triggerId }: { triggerId: string }) {
  const trigger = useTrigger(triggerId);
  const data = trigger.data;
  const missing = trigger.error instanceof ApiError && trigger.error.code === 'trigger_not_found';

  if (trigger.isPending)
    return <p className="text-sm text-muted-foreground">Reading the trigger…</p>;
  if (missing)
    return <p className="text-sm text-muted-foreground">This trigger no longer exists.</p>;
  if (trigger.error || !data)
    return <p className="text-sm text-muted-foreground">{errorMessage(trigger.error)}</p>;

  const rows: [string, string][] = [
    ['Delivery slug', labelled(data.slug)],
    ['Source', labelled(data.source)],
    ['Schedule', labelled(data.schedule)],
    ['Path', labelled(data.path)],
    ['Batch size (max)', labelled(data.batch_size_max)],
    ['Batch window', data.batch_window_ms != null ? `${data.batch_window_ms} ms` : null],
    ['Attempts', labelled(data.max_attempts)],
    ['Payload cap', data.payload_max_bytes != null ? `${data.payload_max_bytes} bytes` : null],
    ['Poison strategy', labelled(data.broker_poison_strategy)],
  ].filter((row): row is [string, string] => row[1] !== null);

  const filter = data.filter_criteria;
  const hasFilter = filter != null && Object.keys(filter).length > 0;
  const hasConfig = data.config != null && Object.keys(data.config).length > 0;

  return (
    <Panel
      title="Configuration"
      description="As deployed. Triggers are defined in gregale.yaml and changed through the CLI."
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill label={data.kind} />
          <Pill
            label={data.enabled ? 'enabled' : 'paused'}
            color={data.enabled ? 'var(--status-good)' : 'var(--status-idle)'}
          />
          <span className="font-mono text-xs text-muted-foreground">{data.id}</span>
        </div>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(([label, value]) => (
            <div key={label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="label-mono text-muted-foreground">{label}</dt>
              <dd className="truncate font-mono text-xs" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <div>
          <p className="label-mono mb-1.5 text-muted-foreground">Filter</p>
          {hasFilter ? (
            <pre className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
              {JSON.stringify(filter, null, 2)}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground">
              No filter: every record from the source is dispatched.
            </p>
          )}
        </div>

        {hasConfig && (
          <div>
            <p className="label-mono mb-1.5 text-muted-foreground">Source configuration</p>
            <pre className="max-h-56 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">
              {JSON.stringify(data.config, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </Panel>
  );
}
