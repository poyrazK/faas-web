import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { ProblemHelp } from '@/components/dashboard/problem-help';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  isActiveRun,
  useCompleteWorkflowCallback,
  useSendWorkflowEvent,
  useWorkflowCallbacks,
  useWorkflowSteps,
  type WorkflowCallback,
  type WorkflowRun,
} from '@/lib/api/workflows';
import { WorkflowStatus } from './workflow-status';

/** Parses an optional JSON field: blank is "no payload", anything else must parse. */
export function parsePayload(text: string): { ok: true; value: unknown } | { ok: false } {
  if (!text.trim()) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

/**
 * Run-level codes that say "use another route", not "try again"
 * (handlers_workflows.go refuseOperationWorkflowControl).
 */
function signalError(err: unknown): string {
  if (!(err instanceof ApiError)) return errorMessage(err);
  switch (err.code) {
    case 'workflow_not_running':
      return 'The run has finished, so it no longer accepts events.';
    case 'operation_signal_required':
      return 'This run belongs to an Operation. Send the event through the operation’s signals instead.';
    case 'operation_approval_required':
      return 'This run belongs to an Operation. Decide its approval through the operation instead.';
    case 'workflow_callback_expired':
      return 'The callback’s wait deadline has passed.';
    case 'workflow_callback_closed':
      return 'The callback step or its run has already finished.';
    case 'workflow_callback_payload_conflict':
      return 'This callback was already completed with a different payload.';
    case 'workflow_step_not_found':
      return 'This run does not declare that callback.';
    default:
      return errorMessage(err);
  }
}

/**
 * Delivers an event a `wait_for_event` step (or an SDK `waitForEvent`) is
 * waiting on. The key is fixed while the form is open, so resending after a
 * lost response records the event once; a fresh form is a fresh event, which
 * a waiting loop needs (each wait consumes one event of its name).
 */
export function SendEventButton({ slug, run }: { slug: string; run: WorkflowRun }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Send event
      </Button>
      {open && <SendEventDialog slug={slug} run={run} onClose={() => setOpen(false)} />}
    </>
  );
}

function SendEventDialog({
  slug,
  run,
  onClose,
}: {
  slug: string;
  run: WorkflowRun;
  onClose: () => void;
}) {
  const id = useId();
  const { toast } = useToast();
  const send = useSendWorkflowEvent(slug);
  const [key] = useState(() => crypto.randomUUID());
  const [name, setName] = useState('');
  const [payload, setPayload] = useState('');
  const [touched, setTouched] = useState(false);
  const parsed = parsePayload(payload);
  const nameError = !name.trim() ? 'Name the event the run waits for.' : undefined;
  const payloadError = parsed.ok ? undefined : 'The payload must be valid JSON, or empty.';

  const submit = async () => {
    setTouched(true);
    if (nameError || !parsed.ok) return;
    try {
      await send.mutateAsync({ id: run.id, eventName: name.trim(), payload: parsed.value, key });
      toast({
        kind: 'success',
        title: `Event ${name.trim()} received`,
        description: 'A step waiting for it continues; one sent early is kept for its wait.',
      });
      onClose();
    } catch {
      // Rendered below from send.error, with its code.
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Send an event to this run"
      description="Wakes a step waiting for an event of this name. Each wait takes one event, in arrival order; an event sent before its wait starts is kept for it."
      width="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" busy={send.isPending} onClick={() => void submit()}>
            Send event
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-name`} className="text-sm font-medium">
            Event name
          </label>
          <Input
            id={`${id}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="approved"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={touched && nameError ? true : undefined}
          />
          {touched && nameError && (
            <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
              {nameError}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-payload`} className="text-sm font-medium">
            Payload (JSON, optional)
          </label>
          <Textarea
            id={`${id}-payload`}
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
            rows={5}
            spellCheck={false}
            className="font-mono"
            placeholder='{"ok": true}'
            aria-invalid={touched && payloadError ? true : undefined}
          />
          {touched && payloadError && (
            <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
              {payloadError}
            </p>
          )}
        </div>
        {send.error && (
          <div role="alert" className="flex flex-col gap-1 text-sm">
            <span style={{ color: 'var(--status-critical)' }}>{signalError(send.error)}</span>
            <ProblemHelp error={send.error} />
          </div>
        )}
      </form>
    </Modal>
  );
}

/**
 * Callback waits declared in the run's captured definition, with the state
 * of the step that waits. The ID names the wait; it is not a credential —
 * completing it needs this account's write access
 * (handlers_workflows.go completeWorkflowCallback).
 */
export function RunCallbacks({ slug, run }: { slug: string; run: WorkflowRun }) {
  const active = isActiveRun(run.status);
  const callbacks = useWorkflowCallbacks(run.id, active);
  const steps = useWorkflowSteps(run.id, active);
  const [completing, setCompleting] = useState<WorkflowCallback | null>(null);
  const status = useMemo(
    () => new Map(steps.data?.steps.map((s) => [s.step_name, s.status]) ?? []),
    [steps.data]
  );
  const rows = callbacks.data?.callbacks ?? [];
  // Most runs declare no callback step; an empty panel would only add noise.
  if (callbacks.data && rows.length === 0) return null;
  return (
    <Panel
      title="Callbacks"
      help="Steps waiting for an outside system to report back. Complete one here when that system cannot call the API itself."
    >
      <InlinePhase
        phase={queryPhase({ loading: callbacks.isPending, error: callbacks.error })}
        error={callbacks.error}
        onRetry={() => void callbacks.refetch()}
      />
      {rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((cb) => {
            const stepStatus = status.get(cb.step_name);
            return (
              <li
                key={cb.id}
                className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{cb.step_name}</span>
                    {stepStatus ? (
                      <WorkflowStatus status={stepStatus} />
                    ) : (
                      <span className="text-xs text-muted-foreground">Not reached yet</span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {cb.expires_at ? (
                      <>
                        Expires <Timestamp value={cb.expires_at} />
                      </>
                    ) : (
                      'Its deadline starts when the step begins waiting.'
                    )}
                  </span>
                </span>
                {active && (
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Complete callback ${cb.step_name}`}
                    onClick={() => setCompleting(cb)}
                  >
                    Complete
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {completing && (
        <CompleteCallbackDialog
          slug={slug}
          run={run}
          callback={completing}
          onClose={() => setCompleting(null)}
        />
      )}
    </Panel>
  );
}

function CompleteCallbackDialog({
  slug,
  run,
  callback,
  onClose,
}: {
  slug: string;
  run: WorkflowRun;
  callback: WorkflowCallback;
  onClose: () => void;
}) {
  const id = useId();
  const { toast } = useToast();
  const complete = useCompleteWorkflowCallback(slug);
  const [payload, setPayload] = useState('');
  const [touched, setTouched] = useState(false);
  const parsed = parsePayload(payload);

  const submit = async () => {
    setTouched(true);
    if (!parsed.ok) return;
    try {
      const result = await complete.mutateAsync({
        id: run.id,
        callbackId: callback.id,
        payload: parsed.value,
      });
      toast(
        result.duplicate
          ? {
              kind: 'info',
              title: 'Already completed',
              description: 'The callback had this same payload already; nothing changed.',
            }
          : {
              kind: 'success',
              title: `Callback ${callback.step_name} completed`,
              description: 'The step continues with this payload.',
            }
      );
      onClose();
    } catch {
      // Rendered below from complete.error, with its code.
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Complete callback ${callback.step_name}`}
      description="Reports the outside result this step is waiting for. It is recorded once: sending the same payload again changes nothing, and a different payload is refused."
      width="max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" busy={complete.isPending} onClick={() => void submit()}>
            Complete callback
          </Button>
        </div>
      }
    >
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label htmlFor={`${id}-payload`} className="text-sm font-medium">
          Result (JSON, optional)
        </label>
        <Textarea
          id={`${id}-payload`}
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
          rows={5}
          spellCheck={false}
          className="font-mono"
          placeholder='{"approved": true}'
          aria-invalid={touched && !parsed.ok ? true : undefined}
        />
        {touched && !parsed.ok && (
          <p className="text-xs" style={{ color: 'var(--status-critical)' }}>
            The result must be valid JSON, or empty.
          </p>
        )}
        {complete.error && (
          <div role="alert" className="mt-2 flex flex-col gap-1 text-sm">
            <span style={{ color: 'var(--status-critical)' }}>{signalError(complete.error)}</span>
            <ProblemHelp error={complete.error} />
          </div>
        )}
      </form>
    </Modal>
  );
}
