import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { CapabilityGate } from '@/components/dashboard/capability-gate';
import { AsyncInvocationsMaturity } from '@/components/dashboard/async-invocations';
import { RetryPolicyFields } from '@/components/dashboard/invocation-option-fields';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { ApiError } from '@/lib/api/errors';
import { useApp, useUpdateApp } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import {
  describeRetryPolicy,
  isBlankRetryDraft,
  retryDraftErrors,
  retryDraftFrom,
  retryPolicyFromDraft,
  type RetryPolicy,
} from '@/lib/invocation-options';

/**
 * The app's invocation retry default — `retry_policy` on `PATCH /v1/apps/{slug}`
 * (faas apidserver/handlers_ext.go:1349-1356, validated by
 * handlers_triggers.go:600). Every durable invocation of the app takes it
 * unless something more specific is set: the request's own `retry_policy`, or
 * a queue binding's (handlers_invocations.go:987). An empty object clears it
 * (handlers.go:24-40), and the plan then decides.
 *
 * `max_retries`, the other "retries" field on the app, is the lifecycle's
 * consecutive restart budget (lifecycle.go:285), not an invocation setting; it
 * lives with the restart contract in Health probes.
 */
export function AppRetryDefaults({ slug }: { slug: string }) {
  return (
    <CapabilityGate capability="async-invocations" title="Retry default">
      <RetryDefaultsPanel slug={slug} />
    </CapabilityGate>
  );
}

const isEmptyPolicy = (policy: RetryPolicy | null | undefined) =>
  !policy ||
  (!policy.max_attempts && !policy.base_seconds && !policy.max_seconds && !policy.jitter_seconds);

function RetryDefaultsPanel({ slug }: { slug: string }) {
  const { account } = useAuth();
  const app = useApp(slug);
  const stored = app.data?.retry_policy ?? null;
  const phase = queryPhase({ error: app.error, loading: app.isPending });
  return (
    <Panel
      title="Retry default"
      description="How this app's async and sync invokes, delayed tasks, queue sends and inbound webhooks retry when they set no curve of their own. A queue binding's policy, or one sent with an invocation, replaces it."
      actions={<AsyncInvocationsMaturity />}
    >
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={app.error}
          loadingMessage="Reading the app…"
          onRetry={() => void app.refetch()}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm">{describeRetryPolicy(stored, account?.plan)}</p>
          {/* Keyed by the stored curve, so a save or another session's change resets the draft. */}
          <RetryDefaultsForm key={JSON.stringify(stored)} slug={slug} stored={stored} />
        </div>
      )}
    </Panel>
  );
}

function RetryDefaultsForm({ slug, stored }: { slug: string; stored: RetryPolicy | null }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const update = useUpdateApp(slug);
  const [draft, setDraft] = useState(() => retryDraftFrom(stored));
  const invalid = Object.keys(retryDraftErrors(draft)).length > 0;
  const unchanged = JSON.stringify(draft) === JSON.stringify(retryDraftFrom(stored));

  const report = (error: unknown) =>
    toast({
      kind: 'error',
      title:
        error instanceof ApiError && error.code === 'trigger_invalid_retry_policy'
          ? 'Retry policy refused'
          : 'Could not save the retry default',
      error,
    });

  const save = async () => {
    let policy: RetryPolicy | undefined;
    try {
      policy = retryPolicyFromDraft(draft);
    } catch (error) {
      toast({ kind: 'error', title: 'Retry policy refused', error });
      return;
    }
    // Blanking every field is a clear, so it asks like one.
    if (!policy) return clear();
    try {
      await update.mutateAsync({ retry_policy: policy });
      toast({ kind: 'success', title: 'Retry default saved' });
    } catch (error) {
      report(error);
    }
  };

  const clear = async () => {
    const ok = await confirm({
      title: 'Use the plan default?',
      description:
        "This app's invocations go back to the plan's attempt cap and the default backoff. Work already queued keeps the curve it was admitted with.",
      confirmLabel: 'Use plan default',
    });
    if (!ok) return;
    try {
      await update.mutateAsync({ retry_policy: {} });
      toast({ kind: 'success', title: 'Retry default cleared' });
    } catch (error) {
      report(error);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid && !unchanged && !update.isPending) void save();
      }}
    >
      <RetryPolicyFields value={draft} onChange={setDraft} disabled={update.isPending} />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!isEmptyPolicy(stored) && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={update.isPending}
            onClick={() => void clear()}
          >
            Use plan default
          </Button>
        )}
        <Button
          type="submit"
          size="sm"
          disabled={invalid || unchanged || (isBlankRetryDraft(draft) && isEmptyPolicy(stored))}
          busy={update.isPending}
        >
          Save default
        </Button>
      </div>
    </form>
  );
}
