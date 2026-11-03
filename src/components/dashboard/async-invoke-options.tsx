import { useState } from 'react';
import { FIELD as BASE_FIELD } from '@/components/ui/field';
import { AsyncInvocationsMaturity } from '@/components/dashboard/async-invocations';
import { DurationField, RetryPolicyFields } from '@/components/dashboard/invocation-option-fields';
import { useAppWorkPolicies, type AsyncInvokeOptions } from '@/lib/api/async-invocations';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { errorMessage } from '@/lib/api/errors';
import { useWebhooks } from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import { durationSeconds, formatDuration, invocationLimits } from '@/lib/invocation-options';

const FIELD = `${BASE_FIELD} w-full`;

/**
 * The async-only fields of `POST /v1/apps/{slug}/invoke/async`
 * (faas pkg/api/dto.go:5945): a named work policy with its key, a hard-stop
 * deadline, a retry curve and result retention for this one invocation, and
 * webhooks told when the work finishes. Closed by default, and its reads wait
 * until it is opened.
 */
export function AsyncInvokeOptionsFields({
  slug,
  value,
  onChange,
}: {
  slug: string;
  value: AsyncInvokeOptions;
  onChange: (next: AsyncInvokeOptions) => void;
}) {
  const { access } = useCapabilityAccess('async-invocations');
  const [open, setOpen] = useState(false);
  if (access !== 'on') return null;
  return (
    <details
      className="rounded-md border border-border sm:col-span-2"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        Retries, retention, deadline, work policy and destinations
        <AsyncInvocationsMaturity />
      </summary>
      {open && (
        <InvocationEnvelopeFields slug={slug} value={value} onChange={onChange} className="p-3" />
      )}
    </details>
  );
}

/**
 * The fields an async invoke and a delayed task share (`invocationEnvelope`).
 * A delayed task has no deadline of its own, so it passes `deadline={false}`.
 */
export function InvocationEnvelopeFields({
  slug,
  value,
  onChange,
  deadline = true,
  className = '',
}: {
  slug: string;
  value: AsyncInvokeOptions;
  onChange: (next: AsyncInvokeOptions) => void;
  deadline?: boolean;
  className?: string;
}) {
  const { account } = useAuth();
  const retentionCap = invocationLimits(account?.plan)?.retentionSeconds;
  const retention = durationSeconds(value.retention);
  const policiesOn = useCapabilityAccess('work-policies').access === 'on';
  const policies = useAppWorkPolicies(slug, policiesOn);
  const hooks = useWebhooks(slug);
  const set = (patch: Partial<AsyncInvokeOptions>) => onChange({ ...value, ...patch });
  const policyList = policies.data ?? [];

  const destination = (label: string, field: 'onSuccess' | 'onFailure') => (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="label-mono text-muted-foreground">{label}</span>
      <select
        aria-label={label}
        value={value[field]}
        onChange={(e) => set({ [field]: e.target.value })}
        disabled={hooks.isPending}
        className={FIELD}
      >
        <option value="">None</option>
        {(hooks.data ?? []).map((hook) => (
          <option key={hook.id} value={hook.id}>
            {hook.target_url}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className={`grid gap-4 border-t border-border sm:grid-cols-2 ${className}`}>
      <div className="sm:col-span-2">
        <RetryPolicyFields value={value.retry} onChange={(retry) => set({ retry })} />
      </div>
      <DurationField
        label="Keep the result for"
        value={value.retention}
        onChange={(next) => set({ retention: next })}
        units={['minutes', 'hours', 'days']}
        placeholder={retentionCap ? formatDuration(retentionCap) : 'Plan window'}
        error={
          retention !== null && Number.isNaN(retention)
            ? 'Enter a positive amount that comes to whole seconds.'
            : undefined
        }
        hint={
          retentionCap
            ? `Up to ${formatDuration(retentionCap)} on your plan; longer is cut to that. Blank keeps the full window. Failed work is kept at least 30 days.`
            : "Blank keeps the plan's full window. Failed work is kept at least 30 days."
        }
      />
      {policiesOn && (
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Work policy</span>
          <select
            aria-label="Work policy"
            value={value.policy}
            onChange={(e) => set({ policy: e.target.value })}
            disabled={policies.isPending}
            className={FIELD}
          >
            <option value="">None</option>
            {policyList.map((policy) => (
              <option key={policy.name} value={policy.name}>
                {policy.name}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {policies.error
              ? errorMessage(policies.error)
              : policies.isSuccess && policyList.length === 0
                ? 'This app has no work policies. Declare them under work_policies in gregale.yaml.'
                : 'Work with the same key runs in order, one at a time.'}
          </span>
        </label>
      )}
      {deadline && (
        <label className="flex min-w-0 flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Deadline (optional)</span>
          <input
            type="datetime-local"
            aria-label="Deadline (optional)"
            value={value.deadline}
            onChange={(e) => set({ deadline: e.target.value })}
            className={FIELD}
          />
          <span className="text-xs text-muted-foreground">
            Still pending or running then, it is dead-lettered. Later than your plan allows is
            clamped to the plan limit.
          </span>
        </label>
      )}
      {policiesOn && value.policy && (
        <>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Work key</span>
            <input
              aria-label="Work key"
              value={value.key}
              onChange={(e) => set({ key: e.target.value })}
              placeholder='"doc-7"'
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
            <span className="text-xs text-muted-foreground">
              A string, number or boolean. &quot;1&quot; and 1 are different keys.
            </span>
          </label>
          <label className="flex min-w-0 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Fairness key (optional)</span>
            <input
              aria-label="Fairness key (optional)"
              value={value.fairnessKey}
              onChange={(e) => set({ fairnessKey: e.target.value })}
              placeholder='"tenant-42"'
              spellCheck={false}
              className={`${FIELD} font-mono`}
            />
          </label>
        </>
      )}
      {destination('On success', 'onSuccess')}
      {destination('On failure', 'onFailure')}
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Destinations are this app&apos;s webhooks; each gets a job.finished event when the work
        completes, or fails for good.
        {hooks.error ? ` ${errorMessage(hooks.error)}` : ''}
      </p>
    </div>
  );
}
