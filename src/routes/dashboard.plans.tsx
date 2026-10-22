import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Check, OpenNewWindow } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useMfa } from '@/components/auth/mfa-provider';
import { PageHeader } from '@/components/dashboard/primitives';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  useBillingPortal,
  useChangePlan,
  useCancelBilling,
  useRetryBilling,
} from '@/lib/api/queries';
import { useAuth, type Plan } from '@/lib/auth';
import { Panel } from '@/components/dashboard/primitives';
import { useConfirm } from '@/components/ui/confirm';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { goToExternal } from '@/lib/external-navigation';
import { consoleHead } from '@/lib/seo';
import { SpendCap } from '@/components/dashboard/spend-cap';

export const Route = createFileRoute('/dashboard/plans')({
  component: PlansPage,
  head: () => consoleHead('plans'),
});

/**
 * Plan selection, against `PATCH /v1/account/plan`.
 *
 * **No prices are shown here.** The API exposes the four plans and their
 * quotas but not what they cost, and the page it replaced listed invented
 * dollar figures. Quoting a number the server cannot confirm is the one thing a
 * billing screen must not do, so pricing links out to the provider's portal,
 * which is authoritative.
 *
 * Switching plans changes a live subscription and can bill immediately, so it
 * goes through a confirmation rather than firing on click.
 */
const PLANS: { id: Plan; name: string; blurb: string; includes: string[] }[] = [
  {
    id: 'free',
    name: 'Free',
    blurb: 'For trying the platform on real workloads.',
    includes: ['Scale to zero', 'Community support'],
  },
  {
    id: 'hobby',
    name: 'Hobby',
    blurb: 'For side projects that need to stay up.',
    includes: ['Custom domains', 'Log archive', 'Streaming responses'],
  },
  {
    id: 'pro',
    name: 'Pro',
    blurb: 'For teams shipping to production.',
    includes: [
      'Higher concurrency',
      'Per-route metrics',
      'CPU autoscaling',
      'Longer log retention',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    blurb: 'Committed capacity and the longest retention.',
    includes: ['Reserved capacity', 'Highest quotas', '90-day log retention'],
  },
];

/** Subscription controls the billing portal buries: retry a failed charge
 * without leaving the console, or schedule a cancel that keeps the account
 * alive until the period ends. */
function BillingControlsPanel() {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { account } = useAuth();
  const cancel = useCancelBilling();
  const retry = useRetryBilling();

  return (
    <Panel
      title="Subscription"
      description="Cancelling takes effect at the end of the current period — nothing stops today."
    >
      <div className="flex flex-wrap items-center gap-3">
        {account?.status === 'past_due' && (
          <Button
            size="sm"
            busy={retry.isPending}
            onClick={() =>
              void retry
                .mutateAsync()
                .then((r) =>
                  toast({
                    kind: r.status === 'failed' ? 'error' : 'success',
                    title: r.status === 'failed' ? 'Charge failed again' : 'Retry submitted',
                    description: r.next_billing_at
                      ? `Next billing ${new Date(r.next_billing_at).toLocaleDateString()}.`
                      : undefined,
                  })
                )
                .catch((err: unknown) =>
                  toast({ kind: 'error', title: 'Could not retry', description: errorMessage(err) })
                )
            }
          >
            Retry payment
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          busy={cancel.isPending}
          onClick={async () => {
            if (
              !(await confirm({
                title: 'Cancel at period end?',
                description:
                  'The subscription ends when the current period does. Apps keep serving until then; after that the account drops to the free tier limits.',
                confirmLabel: 'Schedule cancellation',
                destructive: true,
              }))
            )
              return;
            void cancel
              .mutateAsync()
              .then((r) =>
                toast({
                  kind: 'success',
                  title: 'Cancellation scheduled',
                  description: r.effective_at
                    ? `Effective ${new Date(r.effective_at).toLocaleDateString()}.`
                    : undefined,
                })
              )
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not cancel', description: errorMessage(err) })
              );
          }}
        >
          Cancel at period end
        </Button>
      </div>
    </Panel>
  );
}

/** How often, and for how long, the page re-reads the account while a
 * provider-deferred plan change is outstanding. `GET /v1/account` never
 * reports the pending state, so the plan flipping is the only signal. */
const PENDING_POLL_MS = 15_000;
const PENDING_POLL_WINDOW_MS = 3 * 60_000;

const planName = (id: Plan) => PLANS.find((p) => p.id === id)?.name ?? id;

function PlansPage() {
  const { toast } = useToast();
  const { account, refreshAccount } = useAuth();
  const { openMfa } = useMfa();
  const changePlan = useChangePlan();
  const portal = useBillingPortal();
  const [pending, setPending] = useState<Plan | null>(null);
  // A deferred change (202) leaves the account on its old plan, so the page
  // remembers what was asked for until the account catches up.
  const [requested, setRequested] = useState<{ plan: Plan; effectiveAt?: string } | null>(null);

  const current = account?.plan;
  const awaiting = requested !== null && requested.plan !== current;

  // Once the account reports the requested plan the note has done its job.
  if (requested && requested.plan === current) setRequested(null);
  useEffect(() => {
    if (!awaiting) return;
    const reread = () => void refreshAccount().catch(() => {});
    const timer = window.setInterval(reread, PENDING_POLL_MS);
    const stop = window.setTimeout(() => window.clearInterval(timer), PENDING_POLL_WINDOW_MS);
    window.addEventListener('focus', reread);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(stop);
      window.removeEventListener('focus', reread);
    };
  }, [awaiting, refreshAccount]);

  const stepUp = () =>
    new Promise<boolean>((resolve) =>
      openMfa('verify', { onVerified: () => resolve(true), onDismissed: () => resolve(false) })
    );

  const apply = (plan: Plan, retried = false): Promise<void> =>
    changePlan
      .mutateAsync(plan)
      .then(async (result) => {
        await refreshAccount().catch(() => {});
        if (result.pending) {
          const target = (result.account.requested_plan as Plan | undefined) ?? plan;
          const effectiveAt = result.account.effective_at;
          setRequested({ plan: target, effectiveAt });
          toast({
            kind: 'info',
            title: 'Plan change pending',
            description:
              `You stay on your current plan until the billing provider confirms ${target}.` +
              (effectiveAt
                ? ` It takes effect on ${new Date(effectiveAt).toLocaleDateString()}.`
                : ''),
          });
        } else {
          toast({ kind: 'success', title: `Now on the ${plan} plan` });
        }
      })
      .catch(async (err: unknown) => {
        // The session's step-up is older than five minutes: verify, then ask
        // again — once, so a second refusal is reported rather than looped.
        if (err instanceof ApiError && err.code === 'step_up_required') {
          if (!retried && (await stepUp())) return apply(plan, true);
          toast({
            kind: 'error',
            title: 'Could not change plan',
            description:
              "Confirm it's you with your authenticator code, then retry the change. Plan changes need a recent confirmation.",
          });
          return;
        }
        // An upgrade that needs payment answers 402 with the provider page
        // that takes it; that is the next step, not a failure.
        if (err instanceof ApiError && err.billingUrl) {
          goToExternal(err.billingUrl);
          return;
        }
        // payment_required with no URL: billing has no portal configured and
        // nothing hosted to send the customer to.
        if (err instanceof ApiError && err.code === 'payment_required') {
          toast({
            kind: 'error',
            title: 'Could not change plan',
            description:
              'Billing has no checkout or portal page for this account, so the change cannot be completed here. Contact support to change your plan.',
          });
          return;
        }
        toast({ kind: 'error', title: 'Could not change plan', description: errorMessage(err) });
      });

  const confirm = () => {
    if (!pending) return;
    const plan = pending;
    setPending(null);
    void apply(plan);
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Plans"
        description="Quotas and features per plan. Pricing and payment methods live in the billing portal."
        actions={
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={portal.isPending}
            onClick={() => {
              void portal
                .mutateAsync()
                .then((result) => {
                  if (result.url) window.location.href = result.url;
                })
                .catch((err: unknown) =>
                  toast({
                    kind: 'error',
                    title: 'Could not open the billing portal',
                    description: errorMessage(err),
                  })
                );
            }}
          >
            <OpenNewWindow className="h-3.5 w-3.5" />
            Pricing & payment
          </Button>
        }
      />

      {awaiting && requested && (
        <div
          role="status"
          aria-label="Plan change pending"
          className="rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground"
        >
          A change to the {planName(requested.plan)} plan was requested. You stay on{' '}
          {current ? planName(current) : 'your current plan'} until the billing provider confirms it
          {requested.effectiveAt
            ? `; it takes effect on ${new Date(requested.effectiveAt).toLocaleDateString()}`
            : ''}
          .
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => {
          const isCurrent = plan.id === current;
          return (
            <div
              key={plan.id}
              className="flex flex-col gap-4 rounded-xl border bg-card p-5 transition-colors"
              style={
                isCurrent
                  ? { borderColor: 'color-mix(in oklab, var(--brand) 55%, transparent)' }
                  : undefined
              }
            >
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2">
                  <h2 className="text-sm font-medium">{plan.name}</h2>
                  {isCurrent && <span className="label-mono text-brand">current</span>}
                </span>
                <p className="text-xs text-muted-foreground">{plan.blurb}</p>
              </div>

              <ul className="flex flex-1 flex-col gap-1.5">
                {plan.includes.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Check className="mt-px h-3 w-3 shrink-0 text-brand" />
                    {item}
                  </li>
                ))}
              </ul>

              {isCurrent && account?.limits ? (
                <p className="text-xs text-muted-foreground">
                  {account.limits.deployed_apps} apps · {account.limits.ram_mb} MB ·{' '}
                  {account.limits.included_gb_hours} GB-h included
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full"
                  disabled={!current || changePlan.isPending}
                  onClick={() => setPending(plan.id)}
                >
                  Switch to {plan.name}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <SpendCap />

      <Modal
        open={pending !== null}
        onClose={() => setPending(null)}
        title={`Switch to ${pending ?? ''}?`}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            This updates your subscription straight away and may charge your payment method. Quotas
            change immediately — moving down a plan can put existing apps over the new limits.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPending(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={confirm} busy={changePlan.isPending}>
              Confirm switch
            </Button>
          </div>
        </div>
      </Modal>
      <BillingControlsPanel />
    </div>
  );
}
