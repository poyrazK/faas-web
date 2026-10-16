import { useState, type FormEvent } from 'react';
import { Plus } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import {
  useConsumerPlans,
  useCreateConsumerPlan,
  useUpdateConsumerPlanLimits,
  type ConsumerPlan,
} from '@/lib/api/monetization';
import { Panel } from './primitives';
import { ResourceTable, type Column } from './resource-table';
import {
  MonetizationGate,
  explainWrite,
  formatCount,
  formatUtcDate,
  parseThresholds,
} from './monetization-shared';

/**
 * Consumer plans: named enforcement limits for an app's consumers. Limits
 * change in place (the gateway applies them within 15 seconds); prices do not
 * live here — they are immutable rate-card versions attached to a plan, which
 * the console does not publish yet, so the page says so rather than offering a
 * price field the plan endpoints would ignore.
 */

/** The API caps an app at 20 plans. */
const MAX_PLANS = 20;
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function ApiConsumerPlans({ slug }: { slug: string }) {
  return (
    <MonetizationGate title="Plans">
      <PlansPanel slug={slug} />
    </MonetizationGate>
  );
}

type Row = {
  id: string;
  name: string;
  max_requests_per_minute: number;
  max_units_per_month: number;
  alerts: string;
  updated_at: string;
};

const limit = (n: number) => (n === 0 ? 'Unlimited' : formatCount(n));

function PlansPanel({ slug }: { slug: string }) {
  const plans = useConsumerPlans(slug);
  const [editing, setEditing] = useState<ConsumerPlan | 'new' | null>(null);
  const list = plans.data?.plans ?? [];
  const full = list.length >= MAX_PLANS;
  const rows: Row[] = list.map((p) => ({
    id: p.id,
    name: p.name,
    max_requests_per_minute: p.max_requests_per_minute,
    max_units_per_month: p.max_units_per_month,
    alerts: p.alert_thresholds_percent.length
      ? p.alert_thresholds_percent.map((t) => `${t}%`).join(', ')
      : 'None',
    updated_at: p.updated_at,
  }));
  const columns: Column<Row>[] = [
    {
      key: 'name',
      label: 'Plan',
      sortable: true,
      render: (r) => <span className="font-medium">{r.name}</span>,
    },
    {
      key: 'max_requests_per_minute',
      label: 'Requests / min',
      numeric: true,
      sortable: true,
      render: (r) => limit(r.max_requests_per_minute),
    },
    {
      key: 'max_units_per_month',
      label: 'Units / month',
      numeric: true,
      sortable: true,
      render: (r) => limit(r.max_units_per_month),
    },
    { key: 'alerts', label: 'Usage alerts' },
    {
      key: 'updated_at',
      label: 'Updated',
      priority: 'secondary',
      render: (r) => formatUtcDate(r.updated_at),
    },
  ];

  return (
    <Panel
      title="Consumer plans"
      description="Per-consumer limits; zero means unlimited. Consumers without a plan use the default plan and the app-wide rate cards. Plan prices are rate-card versions published through the API."
      actions={
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => setEditing('new')}
          disabled={full}
          title={full ? `An app can have at most ${MAX_PLANS} plans.` : undefined}
        >
          <Plus className="h-3.5 w-3.5" />
          New plan
        </Button>
      }
    >
      <ResourceTable
        rows={rows}
        columns={columns}
        initialSort={{ key: 'name', dir: 'asc' }}
        onRowClick={(r) => setEditing(list.find((p) => p.id === r.id) ?? null)}
        loading={plans.isPending}
        error={plans.error}
        onRetry={() => void plans.refetch()}
        emptyMessage="No plans yet. Every consumer is on the default plan."
        minWidth="min-w-[600px]"
      />
      {editing && (
        <PlanForm
          key={editing === 'new' ? 'new' : editing.id}
          slug={slug}
          plan={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}

function wholeNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return 0;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

function PlanForm({
  slug,
  plan,
  onClose,
}: {
  slug: string;
  plan?: ConsumerPlan;
  onClose: () => void;
}) {
  const create = useCreateConsumerPlan(slug);
  const update = useUpdateConsumerPlanLimits(slug);
  const { toast } = useToast();
  const [name, setName] = useState(plan?.name ?? '');
  const [rpm, setRpm] = useState(plan ? String(plan.max_requests_per_minute) : '0');
  const [units, setUnits] = useState(plan ? String(plan.max_units_per_month) : '0');
  const [alerts, setAlerts] = useState(plan?.alert_thresholds_percent.join(', ') ?? '');
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<{ title: string; description?: string } | null>(null);
  const busy = create.isPending || update.isPending;

  const rpmValue = wholeNumber(rpm);
  const unitsValue = wholeNumber(units);
  const thresholds = parseThresholds(alerts);
  const errors = {
    name: plan
      ? undefined
      : NAME_PATTERN.test(name)
        ? undefined
        : 'Lowercase letters, digits and hyphens; start with a letter or digit; up to 63 characters.',
    rpm: rpmValue === undefined ? 'Use a whole number (0 for unlimited).' : undefined,
    units: unitsValue === undefined ? 'Use a whole number (0 for unlimited).' : undefined,
    alerts:
      'error' in thresholds
        ? thresholds.error
        : thresholds.values.length > 0 && !unitsValue
          ? 'Alerts are percentages of the monthly unit limit, so set one first.'
          : undefined,
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (Object.values(errors).some(Boolean) || busy || 'error' in thresholds) return;
    setFailure(null);
    const limits = {
      max_requests_per_minute: rpmValue ?? 0,
      max_units_per_month: unitsValue ?? 0,
      alert_thresholds_percent: thresholds.values,
    };
    try {
      if (plan) {
        await update.mutateAsync({ id: plan.id, body: limits });
        toast({
          kind: 'success',
          title: `${plan.name} limits saved`,
          description: 'The gateway applies them within 15 seconds.',
        });
      } else {
        const created = await create.mutateAsync({ name, ...limits });
        toast({ kind: 'success', title: `Plan ${created.name} created` });
      }
      onClose();
    } catch (err) {
      setFailure(
        explainWrite(
          err,
          plan ? 'save the limits' : 'create the plan',
          'A plan with this name already exists'
        )
      );
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={plan ? `Edit ${plan.name}` : 'New plan'}
      description={
        plan
          ? 'Limits change in place. The name and the plan’s prices are not edited here.'
          : 'A named set of limits. Assign it to consumers from their Plan section.'
      }
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
        {!plan && (
          <FormField id="plan-name" label="Name" error={errors.name} showError={attempted}>
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="pro"
                autoComplete="off"
              />
            )}
          </FormField>
        )}
        <FormField
          id="plan-rpm"
          label="Requests per minute"
          hint="Per consumer. Over the limit the gateway answers 429. 0 is unlimited."
          error={errors.rpm}
          showError={attempted}
        >
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              value={rpm}
              onChange={(e) => setRpm(e.target.value)}
            />
          )}
        </FormField>
        <FormField
          id="plan-units"
          label="Units per month"
          hint="Weighted units per consumer per UTC month; over the cap requests get 429 until the month ends. 0 is unlimited."
          error={errors.units}
          showError={attempted}
        >
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
            />
          )}
        </FormField>
        <FormField
          id="plan-alerts"
          label="Usage alert thresholds (%)"
          hint="Up to five percentages of the monthly limit, e.g. 50, 80, 100. Each fires one consumer.usage_threshold webhook per consumer per month. Leave empty for none."
          error={errors.alerts}
          showError={attempted}
        >
          {(props) => (
            <Input
              {...props}
              value={alerts}
              onChange={(e) => setAlerts(e.target.value)}
              placeholder="50, 80, 100"
              autoComplete="off"
            />
          )}
        </FormField>
        {failure && (
          <div role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
            <p className="font-medium">{failure.title}</p>
            {failure.description && <p className="text-muted-foreground">{failure.description}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" busy={busy}>
            {plan ? 'Save limits' : 'Create plan'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
