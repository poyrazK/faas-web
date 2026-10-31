import { useId } from 'react';
import { useAuth } from '@/lib/auth';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useServiceWakeAhead,
  useSetServiceWakeAhead,
  type ServiceWakeAhead as WakeAhead,
  type ServiceWakeAheadTarget,
} from '@/lib/api/service-wake-ahead';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from './primitives';

/** ServiceWakeAheadMinWakes in faas pkg/api/limits.go. */
const MIN_WAKES = 20;

const percent = (share: number) => `${Math.round(share * 100)}%`;
const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function explainError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'capacity_unavailable')
      return 'The wake-ahead setting is briefly unavailable. Try again in a moment.';
    // Also what the platform kill switch answers, so it names neither cause.
    if (error.code === 'not_found')
      return 'Wake-ahead is not available for this app right now. Reload the page to check it still exists.';
  }
  return errorMessage(error);
}

/**
 * An app's service wake-ahead (faas ADR-977): one per-app opt-in, not part of
 * gregale.yaml, so project-owned apps change it here too. A PR preview never
 * learns or wakes ahead, whatever it is set to.
 */
export function ServiceWakeAhead({ slug, previewOf }: { slug: string; previewOf?: string }) {
  const { account } = useAuth();
  const accountId = account?.id ?? '';
  const setting = useServiceWakeAhead(accountId, slug);
  const save = useSetServiceWakeAhead(accountId, slug);
  const { toast } = useToast();
  const labelId = useId();
  const phase = queryPhase({ error: setting.error, loading: setting.isLoading });
  const data = setting.data;
  // Show the requested value while the write is in flight; the query stays
  // the source of truth, so a failed write falls back to what the API holds.
  const checked = save.isPending ? save.variables : (data?.enabled ?? false);

  function change(enabled: boolean) {
    save.mutate(enabled, {
      onSuccess: () =>
        toast({
          kind: 'success',
          title: `Service wake-ahead ${enabled ? 'on' : 'off'} for ${slug}`,
          description: 'Gateways apply it within 30 seconds.',
        }),
      onError: (error) =>
        toast({
          kind: 'error',
          title: 'Could not change service wake-ahead',
          description: explainError(error),
        }),
    });
  }

  return (
    <Panel
      title="Service wake-ahead"
      description="Starts the services this app calls while it wakes, so their restores overlap. Each one woken ahead bills GB-hours from that moment, and one the app never calls bills until its idle timeout parks it."
    >
      <div className="space-y-4 text-sm">
        <InlinePhase
          phase={phase}
          error={setting.error}
          loadingMessage="Loading wake-ahead…"
          onRetry={() => void setting.refetch()}
        />
        {phase === 'ready' && data && (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p id={labelId} className="font-medium">
                  Wake services ahead
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{stateLine(data, previewOf)}</p>
              </div>
              <Switch
                aria-labelledby={labelId}
                checked={checked}
                disabled={Boolean(previewOf) || save.isPending}
                onCheckedChange={change}
              />
            </div>
            {data.learned && !previewOf && <Measured learned={data.learned} />}
            <p className="text-xs text-muted-foreground">
              At most three services per wake, within your plan’s concurrency limit. Skipped while
              the platform is busy, and never stops another app to make room.
            </p>
          </>
        )}
      </div>
    </Panel>
  );
}

function stateLine(data: WakeAhead, previewOf?: string) {
  if (previewOf) return `PR previews never wake services ahead. Set it on ${previewOf}.`;
  if (data.updated_at) return `Turned ${data.enabled ? 'on' : 'off'} ${when(data.updated_at)}.`;
  return data.enabled
    ? 'On: the default for a project service under the project service policy.'
    : 'Off: the default for this app.';
}

function Measured({ learned }: { learned: NonNullable<WakeAhead['learned']> }) {
  if (learned.source !== 'live')
    return (
      <p className="text-muted-foreground">
        Gateway measurements are unavailable right now. The setting still applies.
      </p>
    );
  const seeding = learned.caller_wakes < MIN_WAKES && (
    <p className="text-xs text-muted-foreground">
      Until {MIN_WAKES} cold wakes are measured, wake-ahead starts the services this app declares in{' '}
      <code className="font-mono">depends_on</code>.
    </p>
  );
  if (learned.targets.length === 0)
    return (
      <div className="space-y-1">
        <p className="text-muted-foreground">
          No services measured yet: {learned.caller_wakes} cold wakes observed.
        </p>
        {seeding}
      </div>
    );
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Measured over {learned.caller_wakes} cold wakes; outcomes from the last {learned.window}.
      </p>
      <ul
        aria-label="Measured services"
        className="divide-y divide-border rounded-lg border border-border"
      >
        {learned.targets.map((target) => (
          <Target key={target.app_id} target={target} />
        ))}
      </ul>
      {seeding}
    </div>
  );
}

function Target({ target }: { target: ServiceWakeAheadTarget }) {
  return (
    <li className="space-y-1 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 break-all font-mono text-xs">{target.slug}</span>
        <Badge variant={target.qualifies ? 'secondary' : 'outline'}>
          {target.qualifies ? 'Qualifies' : 'Below threshold'}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Called after {percent(target.call_share)} of wakes, parked on {percent(target.cold_share)}{' '}
        of those calls.
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {target.started} woken ahead · {target.used} used · {target.unused} unused · {target.failed}{' '}
        failed
      </p>
    </li>
  );
}
