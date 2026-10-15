import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Panel } from './primitives';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useRestoreApp } from '@/lib/api/queries';
import { readDeletedApp, useDeletedApps, type DeletedApp } from '@/lib/api/deleted-apps';
import { inspectRestore, type RestoreInspection } from '@/lib/api/deleted-app-restores';
import {
  clearRestoreAttempt,
  listRestoreAttempts,
  type RestoreAttempt,
} from '@/lib/restore-attempt';

type Props = {
  accountId: string;
  cursor: string;
  onNext: (cursor: string) => void;
  onRestart: () => void;
};
const blockers: Record<string, string> = {
  grace_expired: 'Grace expired',
  purge_started: 'Purge has started',
  metadata_unavailable: 'Lifecycle metadata unavailable',
};
const timestamp = (value: string | null) =>
  value ? new Date(value).toLocaleString() : 'Not recorded';

function Recovery({ attempt, onChange }: { attempt: RestoreAttempt; onChange: () => void }) {
  const [inspection, setInspection] = useState<RestoreInspection | null>(null);
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      pending.current?.abort();
    };
  }, []);
  async function inspect() {
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    setAcknowledged(false);
    setInspection(null);
    try {
      const evidence = await inspectRestore(attempt, controller.signal);
      if (alive.current) setInspection(evidence);
    } catch (error) {
      if (alive.current) setMessage(errorMessage(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function clear() {
    try {
      clearRestoreAttempt(attempt);
      onChange();
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }
  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <p className="break-all font-medium">Restore recovery · {attempt.slug}</p>
      <p className="break-all text-xs text-muted-foreground">
        Exact ID {attempt.appId} ·{' '}
        {attempt.phase === 'accepted'
          ? 'Accepted intent; inspect current state'
          : 'Outcome unconfirmed'}
      </p>
      <p className="text-xs">
        A lost response is not permission to repeat the request. Inspection sends reads only.
      </p>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void inspect()}
        aria-label={`Inspect restore ${attempt.slug}`}
      >
        {busy ? 'Inspecting…' : 'Inspect restore'}
      </Button>
      {message && <p role="alert">{message}</p>}
      {inspection?.kind === 'restored' && (
        <div className="space-y-2">
          <p role="status">
            Restored app metadata observed ({inspection.status}). Execution health remains
            unverified.
          </p>
          <Link
            className="text-primary underline"
            to="/dashboard/apps/$appSlug"
            params={{ appSlug: attempt.slug }}
          >
            Open restored app
          </Link>
          <Button variant="outline" onClick={clear}>
            Dismiss observed recovery record
          </Button>
        </div>
      )}
      {inspection?.kind === 'retained' && (
        <div className="space-y-2">
          <p role="status">
            This exact app is still retained. A previous request may still be in progress;
            inspection has not proven a terminal failure.
          </p>
          <p>
            Current deadline: {timestamp(inspection.record.delete_grace_until)} ·{' '}
            {inspection.record.restore_eligible
              ? 'Lifecycle eligible'
              : (blockers[inspection.record.restore_blocker] ?? 'Unavailable')}
          </p>
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            I inspected this identity and choose a fresh review of the current record.
          </label>
          <Button variant="outline" disabled={!acknowledged || busy} onClick={clear}>
            Allow a fresh review
          </Button>
        </div>
      )}
      {inspection?.kind === 'unverified' && (
        <p role="status">{inspection.reason} No request was repeated.</p>
      )}
    </li>
  );
}

export function DeletedApps(props: Props) {
  return <Inventory key={`${props.accountId}:${props.cursor}`} {...props} />;
}
function Inventory({ accountId, cursor, onNext, onRestart }: Props) {
  const list = useDeletedApps(accountId, cursor);
  const restore = useRestoreApp();
  const [attempts, setAttempts] = useState(() => listRestoreAttempts(accountId));
  const [review, setReview] = useState<DeletedApp | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  const sequence = useRef(0);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const tickets = sequence;
    alive.current = true;
    return () => {
      alive.current = false;
      tickets.current++;
      pending.current?.abort();
    };
  }, []);
  const current = (ticket: number) => alive.current && sequence.current === ticket;
  const refreshAttempts = () => setAttempts(listRestoreAttempts(accountId));
  function close() {
    sequence.current++;
    pending.current?.abort();
    setReview(null);
    setBusy(false);
    refreshAttempts();
  }
  async function prepare(row: DeletedApp) {
    const ticket = ++sequence.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const fresh = await readDeletedApp(accountId, row.id, controller.signal);
      if (!current(ticket)) return;
      if (
        fresh.slug !== row.slug ||
        !fresh.restore_eligible ||
        !fresh.deleted_at ||
        !fresh.delete_grace_until
      )
        throw new Error('The retained identity or eligibility changed. Refresh and review again.');
      setReview(fresh);
    } catch (error) {
      if (current(ticket)) setMessage(errorMessage(error));
    } finally {
      if (current(ticket)) setBusy(false);
    }
  }
  async function submit() {
    if (!review?.deleted_at || !review.delete_grace_until || busy) return;
    const ticket = sequence.current;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      await restore.mutateAsync({
        accountId,
        appId: review.id,
        slug: review.slug,
        expectedDeletedAt: review.deleted_at,
        expectedDeadline: review.delete_grace_until,
        signal: controller.signal,
        isCurrent: () => current(ticket),
      });
      if (current(ticket)) {
        setReview(null);
        setMessage(
          'Restore intent accepted. Inspect the matching current app metadata; execution health is not proven.'
        );
      }
    } catch (error) {
      if (current(ticket)) {
        setReview(null);
        setMessage(errorMessage(error));
      }
    } finally {
      if (current(ticket)) {
        setBusy(false);
        refreshAttempts();
        void list.refetch();
      }
    }
  }
  const unavailable = list.error instanceof ApiError && [404, 501].includes(list.error.status);
  return (
    <Panel
      title="Recently deleted"
      description="Account-owned retained apps and server-evaluated restore eligibility."
    >
      <div className="space-y-4 p-4 text-sm">
        <p className="text-muted-foreground">
          Apps normally have a seven-day retention window; the returned deadline and server
          eligibility determine this review. Quota and capacity are checked again. Restoring
          metadata does not prove execution health.
        </p>
        {message && (
          <p role="status" className="break-words">
            {message}
          </p>
        )}
        {attempts.length > 0 && (
          <ul aria-label="Restore recovery records" className="space-y-3">
            {attempts.map((attempt) => (
              <Recovery key={attempt.attemptId} attempt={attempt} onChange={refreshAttempts} />
            ))}
          </ul>
        )}
        {list.isPending ? (
          <p role="status">Reading retained deleted apps…</p>
        ) : list.error ? (
          <div role="alert" className="space-y-2">
            <p>
              {unavailable
                ? 'The account-owned deleted-app inventory is unavailable on this server.'
                : errorMessage(list.error)}
            </p>
            <Button variant="outline" onClick={() => void list.refetch()}>
              Refresh deleted apps
            </Button>
            <Button variant="outline" onClick={onRestart}>
              Restart deleted inventory
            </Button>
          </div>
        ) : list.data ? (
          <>
            <p className="text-xs text-muted-foreground">
              Server evaluation: {timestamp(list.data.evaluated_at)}
            </p>
            {list.data.apps.length === 0 ? (
              <p role="status">
                {cursor
                  ? 'No retained apps were returned on this page.'
                  : 'No retained deleted apps were returned for this account.'}
              </p>
            ) : (
              <ul aria-label="Deleted apps" className="space-y-3">
                {list.data.apps.map((row) => (
                  <li key={row.id} className="space-y-2 rounded-md border border-border p-3">
                    <p className="break-all font-medium">{row.slug}</p>
                    <p className="break-all text-xs text-muted-foreground">Exact ID {row.id}</p>
                    <p>
                      Deleted: {timestamp(row.deleted_at)} · Restore deadline:{' '}
                      {timestamp(row.delete_grace_until)}
                    </p>
                    <p>
                      {row.restore_eligible
                        ? 'Lifecycle eligible; quota and capacity are not reserved'
                        : (blockers[row.restore_blocker] ?? 'Restore unavailable')}
                    </p>
                    <Button
                      variant="outline"
                      disabled={
                        !row.restore_eligible ||
                        busy ||
                        Boolean(review) ||
                        attempts.some((attempt) => attempt.appId === row.id)
                      }
                      aria-label={`Review restore ${row.slug}`}
                      onClick={() => void prepare(row)}
                    >
                      Review restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || Boolean(review)}
                onClick={() => void list.refetch()}
              >
                Refresh deleted apps
              </Button>
              {cursor && (
                <Button variant="outline" disabled={busy || Boolean(review)} onClick={onRestart}>
                  First deleted page
                </Button>
              )}
              <Button
                variant="outline"
                disabled={!list.data.next_cursor || busy || Boolean(review)}
                onClick={() => list.data?.next_cursor && onNext(list.data.next_cursor)}
              >
                Next deleted apps
              </Button>
            </div>
          </>
        ) : null}
      </div>
      <Modal
        open={Boolean(review)}
        onClose={close}
        title={`Restore ${review?.slug ?? 'app'}?`}
        description="Confirm the freshly identified retained app. Eligibility is checked again before the request."
        footer={
          <>
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button disabled={busy || !review} onClick={() => void submit()}>
              {busy ? 'Rechecking…' : 'Confirm restore'}
            </Button>
          </>
        }
      >
        {review && (
          <div className="space-y-2 text-sm">
            <p className="break-all">Exact ID {review.id}</p>
            <p>Deleted {timestamp(review.deleted_at)}</p>
            <p>Restore deadline {timestamp(review.delete_grace_until)}</p>
            <p>
              Restoration counts against current quota. A failed or lost response requires
              inspection before another attempt.
            </p>
          </div>
        )}
      </Modal>
    </Panel>
  );
}
