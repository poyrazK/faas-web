import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Check, OpenNewWindow } from 'iconoir-react';
import { Button } from '@/components/ui/button';
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
import { errorMessage } from '@/lib/api/errors';
import { consoleHead } from '@/lib/seo';

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

function PlansPage() {
  const { toast } = useToast();
  const { account, refreshAccount } = useAuth();
  const changePlan = useChangePlan();
  const portal = useBillingPortal();
  const [pending, setPending] = useState<Plan | null>(null);

  const current = account?.plan;

  const confirm = () => {
    if (!pending) return;
    void changePlan
      .mutateAsync(pending)
      .then(async () => {
        await refreshAccount().catch(() => {});
        toast({ kind: 'success', title: `Now on the ${pending} plan` });
        setPending(null);
      })
      .catch((err: unknown) => {
        setPending(null);
        toast({ kind: 'error', title: 'Could not change plan', description: errorMessage(err) });
      });
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
