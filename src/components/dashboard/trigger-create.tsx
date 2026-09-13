import { useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, Check, Plus } from 'iconoir-react';
import type { Account } from '@/lib/auth';
import type { App } from '@/lib/api/queries';
import { useCreateTrigger } from '@/lib/api/queries';
import { ApiError } from '@/lib/api/errors';
import { Button } from '@/components/ui/button';
import { FieldError, Select } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Panel } from '@/components/dashboard/primitives';
import { PlanGate } from '@/components/dashboard/plan-gate';
import { TriggerSourceFields } from './trigger-source-fields';
import { TriggerDeliveryFields } from './trigger-delivery-fields';
import {
  allowedBrokerKinds,
  buildCreateTriggerRequest,
  clearTriggerSecrets,
  newTriggerDraft,
  sourceDraft,
  validateTriggerDraft,
  type BrokerKind,
} from './trigger-form-model';

const STEPS = ['Destination', 'Event source', 'Delivery & review'] as const;
const KIND_LABELS: Record<BrokerKind, string> = {
  kafka: 'Kafka',
  nats: 'NATS JetStream',
  redis_streams: 'Redis Streams',
  sqs_compat: 'SQS-compatible',
  queue: 'Platform queue',
};

const RECOVERY: Record<string, string> = {
  trigger_kind_not_allowed:
    'That event source is not available on this plan. Choose an allowed kind or compare plans.',
  plan_trigger_quota:
    'This trigger exceeds a plan limit. Review the account quota and delivery ceilings.',
  trigger_batch_window_too_large:
    'The batch window is above the plan maximum. Return to delivery settings and lower it.',
  trigger_tls_skip_verify_not_allowed:
    'TLS verification cannot be skipped on this plan. Turn it back on or compare plans.',
  trigger_invalid_config:
    'The broker rejected this configuration shape. Review the server detail below.',
  secret_store_unavailable:
    'The credential store is unavailable. Your values are still here; retry after the platform is repaired.',
};

function StepRail({ step }: { step: number }) {
  return (
    <ol className="grid grid-cols-3 overflow-hidden rounded-lg border border-border bg-background">
      {STEPS.map((label, index) => (
        <li
          key={label}
          className="flex min-w-0 items-center gap-2 border-r border-border px-3 py-3 last:border-r-0"
          aria-current={index === step ? 'step' : undefined}
        >
          <span
            className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium ${
              index <= step ? 'border-brand text-brand' : 'border-border text-muted-foreground'
            }`}
          >
            {index < step ? <Check className="size-3.5" /> : index + 1}
          </span>
          <span
            className={
              index === step ? 'truncate text-sm' : 'truncate text-sm text-muted-foreground'
            }
          >
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function CreateTrigger({ account, apps }: { account: Account; apps: App[] }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const create = useCreateTrigger();
  const kinds = allowedBrokerKinds(account.limits);
  const [draft, setDraft] = useState(() => newTriggerDraft(account.limits, apps[0]?.id ?? ''));
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const slugRef = useRef<HTMLInputElement>(null);

  if (!account.limits.triggers_allowed || kinds.length === 0) {
    return (
      <PlanGate
        feature="Triggers"
        description="External event triggers are not included on your current plan. Cron schedules remain available separately."
      />
    );
  }
  if (apps.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-14 text-center">
        <p className="text-sm font-medium">Create an app first</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          A trigger needs a destination to invoke.
        </p>
        <Button asChild size="sm" className="mt-4">
          <Link to="/dashboard/workflows/new">Create app</Link>
        </Button>
      </div>
    );
  }

  const validate = (nextStep: 1 | 2) => {
    const all = validateTriggerDraft(draft);
    const relevant =
      nextStep === 1
        ? Object.fromEntries(
            Object.entries(all).filter(([key]) => ['appId', 'kind', 'slug'].includes(key))
          )
        : all;
    setErrors(relevant);
    if (Object.keys(relevant).length > 0) {
      if (relevant.slug) queueMicrotask(() => slugRef.current?.focus());
      return false;
    }
    setSubmissionError(null);
    return true;
  };

  const submit = async () => {
    if (!validate(2)) {
      setStep(1);
      return;
    }
    setSubmissionError(null);
    try {
      const trigger = await create.mutateAsync(buildCreateTriggerRequest(draft));
      setDraft((current) => clearTriggerSecrets(current));
      toast({ kind: 'success', title: `Trigger ${trigger.slug ?? draft.slug} created` });
      await navigate({
        to: '/dashboard/triggers/$triggerId',
        params: { triggerId: trigger.id },
      });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : '';
      setSubmissionError(
        `${RECOVERY[code] ?? 'The trigger could not be created. Retry when the API is available.'}${
          error instanceof ApiError && error.detail ? ` ${error.detail}` : ''
        }`
      );
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <StepRail step={step} />
      <Panel
        title={STEPS[step]}
        description={
          step === 0
            ? 'Choose the immutable destination, source kind, and trigger handle.'
            : step === 1
              ? 'Configure polling and delivery. The platform validates shape when you save; broker connectivity is observed after creation.'
              : 'Confirm how this source invokes your app before it starts consuming.'
        }
      >
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (!create.isPending && step === 2) void submit();
          }}
        >
          {step === 0 && (
            <div className="grid gap-4 md:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Destination app</span>
                <Select
                  aria-label="App to invoke"
                  value={draft.appId}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, appId: event.target.value }))
                  }
                >
                  {apps.map((app) => (
                    <option key={app.id} value={app.id}>
                      {app.slug}
                    </option>
                  ))}
                </Select>
                {errors.appId && <FieldError id="trigger-app-error">{errors.appId}</FieldError>}
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Event source</span>
                <Select
                  aria-label="Trigger kind"
                  value={draft.source.kind}
                  onChange={(event) =>
                    setDraft((value) => ({
                      ...value,
                      source: sourceDraft(event.target.value as BrokerKind),
                    }))
                  }
                >
                  {kinds.map((kind) => (
                    <option key={kind} value={kind}>
                      {KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Trigger slug</span>
                <Input
                  ref={slugRef}
                  aria-label="Trigger slug"
                  aria-invalid={Boolean(errors.slug) || undefined}
                  placeholder="orders-inbound"
                  value={draft.slug}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, slug: event.target.value }))
                  }
                />
                {errors.slug && <FieldError id="trigger-slug-error">{errors.slug}</FieldError>}
              </label>
            </div>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-7">
              <section className="flex flex-col gap-3">
                <h3 className="label-mono text-muted-foreground">Source connection</h3>
                <TriggerSourceFields
                  source={draft.source}
                  errors={errors}
                  limits={account.limits}
                  onChange={(source) => setDraft((value) => ({ ...value, source }))}
                />
              </section>
              <section className="flex flex-col gap-3 border-t border-border pt-6">
                <h3 className="label-mono text-muted-foreground">Delivery contract</h3>
                <TriggerDeliveryFields
                  sourceKind={draft.source.kind}
                  delivery={draft.delivery}
                  filterCriteriaText={draft.filterCriteriaText}
                  errors={errors}
                  limits={account.limits}
                  onDeliveryChange={(delivery) => setDraft((value) => ({ ...value, delivery }))}
                  onFilterChange={(filterCriteriaText) =>
                    setDraft((value) => ({ ...value, filterCriteriaText }))
                  }
                />
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
              <dl className="grid gap-4 rounded-lg border border-border bg-background p-4 sm:grid-cols-2">
                {[
                  ['Destination', apps.find((app) => app.id === draft.appId)?.slug ?? draft.appId],
                  ['Source', KIND_LABELS[draft.source.kind]],
                  ['Slug', draft.slug],
                  [
                    'Batch / window',
                    `${draft.delivery.batchSizeMax} / ${draft.delivery.batchWindowMs} ms`,
                  ],
                  ['Attempts', String(draft.delivery.maxAttempts)],
                  ['Payload cap', `${draft.delivery.payloadMaxBytes} bytes`],
                  ['Initial state', draft.delivery.enabled ? 'Enabled' : 'Paused'],
                  ['Filter', draft.filterCriteriaText.trim() ? 'Configured' : 'Every record'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="label-mono text-muted-foreground">{label}</dt>
                    <dd className="mt-1 font-mono text-xs">{value}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted p-4">
                <p className="label-mono text-muted-foreground">Handler contract</p>
                <code className="font-mono text-xs text-brand">
                  POST /_triggers/{draft.source.kind}/{draft.slug}
                </code>
                <pre className="overflow-auto font-mono text-xs text-muted-foreground">
                  {'{\n  "batchItemFailures": [\n    { "itemIdentifier": "record-id" }\n  ]\n}'}
                </pre>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Omit failures for full success. Failed records retry up to the configured limit,
                  then move to dead letter.
                </p>
              </div>
            </div>
          )}

          {submissionError && (
            <div role="alert" className="rounded-md border border-border bg-muted px-4 py-3">
              <p className="text-sm">{submissionError}</p>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div>
              {step > 0 ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={create.isPending}
                  onClick={() => setStep((step - 1) as 0 | 1)}
                >
                  <ArrowLeft /> Back
                </Button>
              ) : (
                <Link to="/dashboard/crons" className="text-xs text-brand hover:underline">
                  Need a schedule? Create a cron
                </Link>
              )}
            </div>
            {step === 0 ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (validate(1)) setStep(1);
                }}
              >
                Next <ArrowRight />
              </Button>
            ) : step === 1 ? (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (validate(2)) setStep(2);
                }}
              >
                Review <ArrowRight />
              </Button>
            ) : (
              <Button type="submit" size="sm" busy={create.isPending}>
                <Plus /> Create trigger
              </Button>
            )}
          </div>
        </form>
      </Panel>
      <p className="text-xs text-muted-foreground">
        The API enforces {account.limits.trigger_limit_per_app} triggers per app and{' '}
        {account.limits.trigger_limit_per_account} per account on this plan.
      </p>
    </div>
  );
}
