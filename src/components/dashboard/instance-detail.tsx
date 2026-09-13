import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import type { components } from '@/lib/api/schema';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { useDetailFocus } from './use-detail-focus';
import { WakeTimeline } from './wake-timeline';

type Instance = components['schemas']['InstanceResponse'];
const missing = 'Not reported';

function timestamp(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return missing;
  return <time dateTime={value}>{value}</time>;
}

function elapsed(start?: string | null, end?: string | null) {
  if (!start) return missing;
  const seconds = Math.floor(((end ? Date.parse(end) : Date.now()) - Date.parse(start)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return missing;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function InstanceDetail({
  id,
  revealRequest,
  instance,
  slug,
  loading,
  error,
  onRetry,
  appsLoading,
  appsError,
  onRetryApps,
  onClose,
}: {
  id: string;
  revealRequest: number;
  instance?: Instance;
  slug?: string;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  appsLoading: boolean;
  appsError: unknown;
  onRetryApps: () => void;
  onClose: () => void;
}) {
  const panelRef = useDetailFocus(id, revealRequest);
  const phase = queryPhase({ error, loading, isEmpty: !instance });
  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      aria-label="Instance details"
      className="scroll-mt-24 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Panel
        title="Instance details"
        actions={
          <Button size="xs" variant="ghost" onClick={onClose}>
            Close
          </Button>
        }
      >
        {phase !== 'ready' || !instance ? (
          <div className="flex flex-col items-start gap-3">
            <InlinePhase
              phase={phase}
              error={error}
              loadingMessage="Loading instances…"
              emptyMessage="This instance is not in the current instance list. It may have parked or been removed. Refresh the list or select another instance."
            />
            {(error || phase === 'empty') && (
              <Button size="xs" variant="outline" onClick={onRetry}>
                Retry instance list
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Instance', instance.id],
                ['State', instance.state],
                ['App', slug ?? missing],
                ['App ID', instance.app_id],
                ['Release / deployment', instance.deployment_id || missing],
                ['Execution mode', instance.execution_mode ?? missing],
                ['Host IP', instance.host_ip ?? missing],
                ['RAM', `${instance.ram_mb} MB`],
                ['Started', timestamp(instance.started_at)],
                ['Parked', timestamp(instance.parked_at)],
                ['Last request', timestamp(instance.last_request_at)],
                ['Age since start', elapsed(instance.started_at)],
                [
                  'Duration before parking',
                  instance.parked_at ? elapsed(instance.started_at, instance.parked_at) : missing,
                ],
                ['Minimum instance target', instance.min_instances_target ?? missing],
                ['Lifecycle failure reason', instance.lifecycle_failure_reason ?? missing],
                ['Wake ID', instance.wake_id || missing],
              ].map(([label, value]) => (
                <div key={String(label)} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words font-mono text-xs">{value}</dd>
                </div>
              ))}
            </dl>
            <nav
              aria-label="Instance context"
              className="flex flex-wrap gap-4 text-sm underline underline-offset-4"
            >
              {slug && (
                <Link to="/dashboard/workflows/$workflowId" params={{ workflowId: slug }}>
                  Open app
                </Link>
              )}
              {instance.deployment_id && (
                <Link to="/dashboard/deployments" search={{ deployment: instance.deployment_id }}>
                  Open release
                </Link>
              )}
              {slug && (
                <Link to="/dashboard/logs" search={{ app: slug }}>
                  App logs
                </Link>
              )}
              {slug && (
                <Link
                  to="/dashboard/workflows/$workflowId"
                  params={{ workflowId: slug }}
                  search={{ tab: 'Debugger' }}
                >
                  App debugger
                </Link>
              )}
            </nav>
            <div className="flex flex-col items-start gap-3">
              {appsLoading || appsError ? (
                <>
                  <InlinePhase
                    phase={queryPhase({ error: appsError, loading: appsLoading })}
                    error={appsError}
                    loadingMessage="Resolving the app…"
                  />
                  {Boolean(appsError) && (
                    <Button size="xs" variant="outline" onClick={onRetryApps}>
                      Retry app lookup
                    </Button>
                  )}
                </>
              ) : !slug ? (
                <p className="text-sm text-muted-foreground">
                  The app could not be resolved. Refresh the app list to load app links and wake
                  evidence.
                </p>
              ) : null}
              {!slug && !appsLoading && !appsError && (
                <Button size="xs" variant="outline" onClick={onRetryApps}>
                  Refresh app list
                </Button>
              )}
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium">Wake timeline</h3>
              {!instance.wake_id ? (
                <p className="text-sm text-muted-foreground">
                  No wake ID was returned for this instance. Use app logs or the debugger for other
                  evidence.
                </p>
              ) : slug && !appsLoading && !appsError ? (
                <WakeTimeline slug={slug} wakeId={instance.wake_id} />
              ) : null}
            </div>
          </div>
        )}
      </Panel>
    </section>
  );
}
