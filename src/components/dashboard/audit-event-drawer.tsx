import { Modal } from '@/components/ui/modal';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { useAuditEvent } from '@/lib/api/queries';
import type { components } from '@/lib/api/schema';

type Event = components['schemas']['AuditEventResponse'];

const SEVERITY_COLOR: Record<string, string | undefined> = {
  high: 'var(--status-critical)',
  warn: 'var(--status-warning)',
  info: undefined,
};

export function AuditEventBody({ event }: { event: Event }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {[
          ['Kind', event.kind],
          ['At', new Date(event.at).toLocaleString()],
          ['Actor', event.actor],
          ['Subject', event.subject ?? '—'],
        ].map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="label-mono text-muted-foreground">{k}</dt>
            <dd className="break-all font-mono text-xs">{v}</dd>
          </div>
        ))}
      </dl>
      {event.severity && (
        <div>
          <Pill label={event.severity} color={SEVERITY_COLOR[event.severity]} />
        </div>
      )}
      <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-[11px]">
        {JSON.stringify(event.data, null, 2)}
      </pre>
    </div>
  );
}

/** `gregale audit get <id>`: the whole row, payload included. The API never carries plaintext secrets in `data`. */
export function AuditEventDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useAuditEvent(id ?? '');
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: !q.data });
  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title="Audit event"
      description={id ?? undefined}
      width="max-w-xl"
    >
      {phase !== 'ready' || !q.data ? (
        <InlinePhase phase={phase} error={q.error} emptyMessage="No such event." />
      ) : (
        <AuditEventBody event={q.data} />
      )}
    </Modal>
  );
}
