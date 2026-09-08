import { Modal } from '@/components/ui/modal';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useAuditEvent } from '@/lib/api/queries';

/**
 * One auth audit event in full, behind the security page's list. The list
 * shows kind, actor and time; the detail adds the subject, the severity and
 * the `data` payload the API recorded, verbatim. A cross-account id is
 * indistinguishable from a missing one on purpose, so `not_found` reads as
 * "no such event" rather than as a permissions problem.
 */
export function AuthEventDetail({ id, onClose }: { id: string | null; onClose: () => void }) {
  const event = useAuditEvent(id ?? '');
  const data = event.data;
  const missing = event.error instanceof ApiError && event.error.code === 'not_found';

  return (
    <Modal
      open={id !== null}
      onClose={onClose}
      title={data ? data.kind : 'Auth event'}
      description={data ? `${data.actor} · ${new Date(data.at).toLocaleString()}` : undefined}
      width="max-w-lg"
    >
      {event.isPending ? (
        <p className="text-sm text-muted-foreground">Reading the event…</p>
      ) : missing ? (
        <p className="text-sm text-muted-foreground">No such event on this account.</p>
      ) : event.error || !data ? (
        <p className="text-sm text-muted-foreground">{errorMessage(event.error)}</p>
      ) : (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="label-mono text-muted-foreground">Event id</dt>
            <dd className="font-mono text-xs">{data.id}</dd>
          </div>
          <div>
            <dt className="label-mono text-muted-foreground">Severity</dt>
            <dd className="text-xs">{data.severity ?? 'info'}</dd>
          </div>
          <div>
            <dt className="label-mono text-muted-foreground">Actor</dt>
            <dd className="font-mono text-xs">{data.actor}</dd>
          </div>
          <div>
            <dt className="label-mono text-muted-foreground">Subject</dt>
            <dd className="font-mono text-xs">{data.subject ?? '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="label-mono text-muted-foreground">Data</dt>
            <dd>
              {Object.keys(data.data ?? {}).length === 0 ? (
                <span className="text-xs text-muted-foreground">No payload recorded.</span>
              ) : (
                <pre className="mt-1 max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
                  {JSON.stringify(data.data, null, 2)}
                </pre>
              )}
            </dd>
          </div>
        </dl>
      )}
    </Modal>
  );
}
