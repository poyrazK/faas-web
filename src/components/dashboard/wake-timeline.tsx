import { Button } from '@/components/ui/button';
import { useWakeTimeline } from '@/lib/api/queries';
import { InlinePhase, queryPhase } from './primitives';

/** The existing canonical wake frames, shared as inline instance evidence. */
export function WakeTimeline({ slug, wakeId }: { slug: string; wakeId: string }) {
  const q = useWakeTimeline(slug, wakeId);
  const events = q.data?.events ?? [];
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: events.length === 0 });
  const t0 = events.length ? Date.parse(events[0].at) : 0;
  return (
    <div className="flex flex-col items-start gap-3">
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage="Reading the timeline…"
          emptyMessage="No frames recorded for this wake. Check the app debugger for request evidence."
        />
      ) : (
        <ol className="flex w-full flex-col">
          {events.map((e, i) => {
            const dt = Math.max(0, Date.parse(e.at) - t0);
            return (
              <li
                key={`${e.at}-${i}`}
                className="flex items-baseline gap-4 border-b border-border py-2 text-xs last:border-0"
              >
                <span className="w-16 shrink-0 text-right font-mono text-muted-foreground [font-variant-numeric:tabular-nums]">
                  +{dt} ms
                </span>
                <span className="font-mono">{e.kind}</span>
                {e.actor && <span className="text-muted-foreground">{e.actor}</span>}
              </li>
            );
          })}
        </ol>
      )}
      {q.error && (
        <Button size="xs" variant="outline" onClick={() => void q.refetch()}>
          Retry timeline
        </Button>
      )}
    </div>
  );
}
