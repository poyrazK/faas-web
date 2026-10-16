import { useMemo, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Xmark } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { OneTimeSecret, useOneTimeSecret } from '@/components/ui/one-time-secret';
import { Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import {
  PLAN_LOOKUP_CAP,
  currentAssignment,
  issueConsumerKey,
  monetizationKeys,
  planTimeline,
  useAssignPlan,
  useAssignmentsFor,
  useConsumerKeys,
  useConsumerPlans,
  useConsumerQuote,
  useConsumerUsage,
  useConsumers,
  useCreateConsumer,
  usePlanAssignments,
  useRevokeConsumer,
  useRevokeConsumerKey,
  useUsageAlerts,
  type Consumer,
  type ConsumerKeyScope,
  type ConsumerPlan,
} from '@/lib/api/monetization';
import { InlinePhase, Panel, StatTile, queryPhase } from './primitives';
import { Pill, ResourceTable, type Column } from './resource-table';
import { SegmentedControl } from './tabs';
import { ConsumerStatements } from './api-consumer-statements';
import {
  Facts,
  MonetizationGate,
  STATUS_COLOR,
  explainWrite,
  formatCount,
  formatMillicents,
  formatPeriod,
  formatUtc,
  formatUtcDate,
  trailingDays,
  utcMinuteFromInput,
} from './monetization-shared';

/**
 * App consumers (ADR-120): the stable identities of the customers who call a
 * monetized API. The default view is the list and "Register consumer"; keys,
 * plan, usage and statements open behind a row.
 *
 * The consumer record does not carry its plan, so the list's Plan column is
 * read from each consumer's assignment history — for the first
 * `PLAN_LOOKUP_CAP` consumers only, and it says so past that.
 */
export function ApiConsumers({ slug }: { slug: string }) {
  return (
    <MonetizationGate title="Consumers">
      <ConsumersPanel slug={slug} />
    </MonetizationGate>
  );
}

type Row = {
  id: string;
  name: string;
  external_ref: string;
  plan: string;
  status: Consumer['status'];
  created_at: string;
};

function planLabel(planId: string | undefined, plans: readonly ConsumerPlan[] | undefined) {
  if (!planId) return 'Default';
  return plans?.find((p) => p.id === planId)?.name ?? 'Unknown plan';
}

function ConsumersPanel({ slug }: { slug: string }) {
  const consumers = useConsumers(slug);
  const plans = useConsumerPlans(slug);
  const [selectedId, setSelectedId] = useState('');
  const [registering, setRegistering] = useState(false);
  const list = useMemo(() => consumers.data?.consumers ?? [], [consumers.data]);
  const assignments = useAssignmentsFor(
    slug,
    list.map((c) => c.id)
  );

  const rows: Row[] = list.map((c, index) => {
    const q = assignments[index];
    const plan = !q
      ? `Open to see (first ${PLAN_LOOKUP_CAP} shown)`
      : q.isPending
        ? '…'
        : q.error
          ? 'Unavailable'
          : planLabel(currentAssignment(q.data ?? [])?.plan_id, plans.data?.plans);
    return {
      id: c.id,
      name: c.name,
      external_ref: c.external_ref,
      plan,
      status: c.status,
      created_at: c.created_at,
    };
  });
  const selected = list.find((c) => c.id === selectedId);

  const columns: Column<Row>[] = [
    {
      key: 'name',
      label: 'Consumer',
      sortable: true,
      render: (r) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{r.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{r.external_ref}</span>
        </div>
      ),
    },
    { key: 'plan', label: 'Plan', sortable: true },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Pill label={r.status} color={STATUS_COLOR[r.status]} />,
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      priority: 'secondary',
      render: (r) => formatUtcDate(r.created_at),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Consumers"
        description="Stable identities for the customers who call this API. Keys, plans, usage and statements belong to a consumer."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setRegistering(true)}>
            <Plus className="h-3.5 w-3.5" />
            Register consumer
          </Button>
        }
      >
        <ResourceTable
          rows={rows}
          columns={columns}
          initialSort={{ key: 'created_at', dir: 'desc' }}
          searchKeys={['name', 'external_ref']}
          searchPlaceholder="Filter by name or external reference…"
          onRowClick={(r) => setSelectedId(r.id)}
          loading={consumers.isPending}
          error={consumers.error}
          onRetry={() => void consumers.refetch()}
          emptyMessage="No consumers yet. Register one for each customer that calls this API."
          minWidth="min-w-[560px]"
        />
      </Panel>
      {selected && (
        <ConsumerDetail
          key={selected.id}
          slug={slug}
          consumer={selected}
          plans={plans.data?.plans}
          onClose={() => setSelectedId('')}
        />
      )}
      <RegisterConsumer
        slug={slug}
        open={registering}
        onClose={() => setRegistering(false)}
        onRegistered={(id) => setSelectedId(id)}
      />
    </div>
  );
}

function RegisterConsumer({
  slug,
  open,
  onClose,
  onRegistered,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
  onRegistered: (id: string) => void;
}) {
  const create = useCreateConsumer(slug);
  const { toast } = useToast();
  const [externalRef, setExternalRef] = useState('');
  const [name, setName] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<{ title: string; description?: string } | null>(null);
  const refError =
    externalRef.trim().length === 0
      ? 'Enter the reference your systems use for this customer.'
      : externalRef.trim().length > 256
        ? 'Use 256 characters or fewer.'
        : undefined;
  const nameError =
    name.trim().length === 0
      ? 'Enter a display name.'
      : name.trim().length > 128
        ? 'Use 128 characters or fewer.'
        : undefined;

  const close = () => {
    setExternalRef('');
    setName('');
    setAttempted(false);
    setFailure(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (refError || nameError || create.isPending) return;
    setFailure(null);
    try {
      const consumer = await create.mutateAsync({
        external_ref: externalRef.trim(),
        name: name.trim(),
      });
      toast({ kind: 'success', title: `${consumer.name} registered` });
      onRegistered(consumer.id);
      close();
    } catch (err) {
      setFailure(
        explainWrite(
          err,
          'register the consumer',
          'A consumer with this external reference already exists'
        )
      );
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Register consumer"
      description="A stable identity for one customer of this API. Keys are issued to it afterwards."
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <FormField
          id="consumer-external-ref"
          label="External reference"
          hint="Your own ID for this customer, such as a CRM or billing account ID."
          error={refError}
          showError={attempted}
        >
          {(props) => (
            <Input
              {...props}
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              placeholder="customer-42"
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField id="consumer-name" label="Name" error={nameError} showError={attempted}>
          {(props) => (
            <Input
              {...props}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme"
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
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" busy={create.isPending}>
            Register consumer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Section = 'keys' | 'plan' | 'usage' | 'statements';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'keys', label: 'Keys' },
  { key: 'plan', label: 'Plan' },
  { key: 'usage', label: 'Usage' },
  { key: 'statements', label: 'Statements' },
];

function ConsumerDetail({
  slug,
  consumer,
  plans,
  onClose,
}: {
  slug: string;
  consumer: Consumer;
  plans: readonly ConsumerPlan[] | undefined;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>('keys');
  const revoke = useRevokeConsumer(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const active = consumer.status === 'active';

  const onRevoke = async () => {
    if (
      !(await confirm({
        title: `Revoke ${consumer.name}?`,
        description: 'The consumer identity is marked revoked. Revoking cannot be undone.',
        confirmLabel: 'Revoke consumer',
        destructive: true,
      }))
    )
      return;
    try {
      await revoke.mutateAsync(consumer.id);
      toast({ kind: 'success', title: `${consumer.name} revoked` });
    } catch (err) {
      toast(explainWrite(err, 'revoke the consumer'));
    }
  };

  return (
    <Panel
      title={consumer.name}
      description={`External reference ${consumer.external_ref}`}
      actions={
        <div className="flex items-center gap-2">
          {active && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onRevoke()}
              busy={revoke.isPending}
            >
              Revoke consumer
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close consumer details">
            <Xmark className="h-3.5 w-3.5" />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Facts
          items={[
            [
              'Status',
              <Pill key="s" label={consumer.status} color={STATUS_COLOR[consumer.status]} />,
            ],
            [
              'Consumer ID',
              <span key="id" className="font-mono text-xs">
                {consumer.id}
              </span>,
            ],
            ['Created', formatUtc(consumer.created_at)],
            ...(consumer.revoked_at
              ? ([['Revoked', formatUtc(consumer.revoked_at)]] as [string, string][])
              : []),
            ...(consumer.managed_by_platform_tenant
              ? ([['Managed by', 'A customer bundle (Customers page)']] as [string, string][])
              : []),
          ]}
        />
        <SegmentedControl
          label="Consumer sections"
          value={section}
          options={SECTIONS}
          onChange={setSection}
        />
        {section === 'keys' && <ConsumerKeys slug={slug} consumer={consumer} />}
        {section === 'plan' && (
          <ConsumerPlanSection slug={slug} consumer={consumer} plans={plans} />
        )}
        {section === 'usage' && <ConsumerUsage slug={slug} consumer={consumer} />}
        {section === 'statements' && <ConsumerStatements slug={slug} consumerId={consumer.id} />}
      </div>
    </Panel>
  );
}

// --- Keys ----------------------------------------------------------------------

const SCOPES: ConsumerKeyScope[] = ['read', 'write', 'admin'];

function ConsumerKeys({ slug, consumer }: { slug: string; consumer: Consumer }) {
  const keys = useConsumerKeys(slug, consumer.id);
  const revoke = useRevokeConsumerKey(slug, consumer.id);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const evidence = useOneTimeSecret<string>();
  const [issuing, setIssuing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ConsumerKeyScope[]>(['read']);
  const [expires, setExpires] = useState('');
  const [attempted, setAttempted] = useState(false);
  const active = consumer.status === 'active';
  const nameError =
    name.trim().length === 0
      ? 'Name the key, e.g. "primary".'
      : name.trim().length > 64
        ? 'Use 64 characters or fewer.'
        : undefined;
  const scopeError = scopes.length === 0 ? 'Choose at least one scope.' : undefined;
  const expiresAt = expires ? utcMinuteFromInput(expires) : undefined;
  const expiresError = expires && !expiresAt ? 'Use a full date and time.' : undefined;
  const phase = queryPhase({
    error: keys.error,
    loading: keys.isPending,
    isEmpty: keys.data?.length === 0,
  });

  const issue = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (nameError || scopeError || expiresError || busy) return;
    const receive = evidence.capture();
    setBusy(true);
    try {
      const created = await issueConsumerKey(slug, consumer.id, {
        name: name.trim(),
        scopes,
        ...(expiresAt ? { expires_at: expiresAt } : {}),
      });
      receive(created.key ?? null);
      if (!created.key)
        toast({
          kind: 'info',
          title: 'Key issued',
          description: 'The response carried no plaintext, so there is nothing to copy.',
        });
      setIssuing(false);
      setName('');
      setScopes(['read']);
      setExpires('');
      setAttempted(false);
    } catch (err) {
      receive(null);
      toast(explainWrite(err, 'issue the key'));
    } finally {
      setBusy(false);
      void qc.invalidateQueries({ queryKey: monetizationKeys.keys(slug, consumer.id) });
    }
  };

  const onRevoke = async (keyId: string, keyName: string) => {
    if (
      !(await confirm({
        title: `Revoke key "${keyName}"?`,
        description: `Requests from ${consumer.name} using this key are rejected from now on. A revoked key cannot be restored; issue a new one instead.`,
        confirmLabel: 'Revoke key',
        destructive: true,
      }))
    )
      return;
    try {
      await revoke.mutateAsync(keyId);
      toast({ kind: 'success', title: `Key "${keyName}" revoked` });
    } catch (err) {
      toast(explainWrite(err, 'revoke the key'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {evidence.secret && (
        <OneTimeSecret
          key={evidence.version}
          value={evidence.secret}
          title={`New key for ${consumer.name}`}
          description="This is the only time the plaintext is shown; the API keeps only its prefix."
          onDismiss={evidence.dismiss}
        />
      )}
      <InlinePhase
        phase={phase}
        error={keys.error}
        loadingMessage="Loading keys…"
        emptyMessage="No keys yet."
        onRetry={() => void keys.refetch()}
      />
      {phase === 'ready' && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {keys.data?.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
              <span className="text-sm font-medium">{k.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{k.prefix}…</span>
              <span className="text-xs text-muted-foreground">{k.scopes.join(', ')}</span>
              <span className="text-xs text-muted-foreground">
                {k.last_used_at ? `last used ${formatUtc(k.last_used_at)}` : 'never used'}
                {k.expires_at ? ` · expires ${formatUtc(k.expires_at)}` : ''}
              </span>
              <span className="ml-auto">
                {k.revoked_at ? (
                  <Pill label="revoked" color={STATUS_COLOR.revoked} />
                ) : (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => void onRevoke(k.id, k.name)}
                    disabled={revoke.isPending}
                    aria-label={`Revoke key ${k.name}`}
                  >
                    Revoke
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {!active ? (
        <p className="text-sm text-muted-foreground">
          This consumer is revoked, so no new keys can be issued to it.
        </p>
      ) : !issuing ? (
        <div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setIssuing(true)}>
            <Plus className="h-3.5 w-3.5" />
            Issue key
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4 rounded-lg border border-border p-4"
          onSubmit={(e) => void issue(e)}
          noValidate
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              id="consumer-key-name"
              label="Key name"
              error={nameError}
              showError={attempted}
            >
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="primary"
                  autoComplete="off"
                />
              )}
            </FormField>
            <FormField
              id="consumer-key-expires"
              label="Expires (UTC, optional)"
              error={expiresError}
              showError={attempted}
            >
              {(props) => (
                <Input
                  {...props}
                  type="datetime-local"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              )}
            </FormField>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-sm font-medium">Scopes</legend>
            <div className="flex flex-wrap gap-4">
              {SCOPES.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scopes.includes(scope)}
                    onChange={(e) =>
                      setScopes((current) =>
                        e.target.checked
                          ? SCOPES.filter((s) => s === scope || current.includes(s))
                          : current.filter((s) => s !== scope)
                      )
                    }
                  />
                  {scope}
                </label>
              ))}
            </div>
            {attempted && scopeError && (
              <p role="alert" className="text-[13px] text-destructive">
                {scopeError}
              </p>
            )}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setIssuing(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" busy={busy}>
              Issue key
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

// --- Plan ----------------------------------------------------------------------

function ConsumerPlanSection({
  slug,
  consumer,
  plans,
}: {
  slug: string;
  consumer: Consumer;
  plans: readonly ConsumerPlan[] | undefined;
}) {
  const assignments = usePlanAssignments(slug, consumer.id);
  const assign = useAssignPlan(slug, consumer.id);
  const { toast } = useToast();
  const [target, setTarget] = useState('');
  const [timing, setTiming] = useState<'next' | 'at'>('next');
  const [at, setAt] = useState('');
  const history = assignments.data ?? [];
  const { current, scheduled } = planTimeline(history);
  const effectiveFrom = timing === 'at' ? utcMinuteFromInput(at) : undefined;
  const ready = timing === 'next' || Boolean(effectiveFrom);
  const phase = queryPhase({ error: assignments.error, loading: assignments.isPending });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || assign.isPending) return;
    try {
      const result = await assign.mutateAsync({
        ...(target ? { plan_id: target } : {}),
        ...(effectiveFrom ? { effective_from: effectiveFrom } : {}),
      });
      toast({
        kind: 'success',
        title: `Moving to ${planLabel(result.plan_id, plans)}`,
        description: `Takes effect ${formatUtc(result.effective_from)}.`,
      });
      setTiming('next');
      setAt('');
    } catch (err) {
      toast(
        explainWrite(
          err,
          'move the plan',
          'Could not move the plan: the target plan needs a rate card in force at that minute'
        )
      );
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <InlinePhase
        phase={phase}
        error={assignments.error}
        loadingMessage="Loading plan history…"
        onRetry={() => void assignments.refetch()}
      />
      {phase === 'ready' && (
        <>
          <p className="text-sm">
            On <strong>{planLabel(current?.plan_id, plans)}</strong>
            {current ? ` since ${formatUtc(current.effective_from)}` : ''}.
            {!current?.plan_id && (
              <span className="text-muted-foreground">
                {' '}
                The default plan prices usage with the app-wide rate cards.
              </span>
            )}
          </p>
          {scheduled.map((a) => (
            <p key={a.id} className="text-sm text-muted-foreground">
              Scheduled: {planLabel(a.plan_id, plans)} from {formatUtc(a.effective_from)}.
            </p>
          ))}
          {history.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Assignment history ({history.length})
              </summary>
              <ul className="mt-2 flex flex-col gap-1">
                {history.map((a) => (
                  <li key={a.id} className="flex flex-wrap gap-x-3 text-xs">
                    <span className="font-medium">{planLabel(a.plan_id, plans)}</span>
                    <span className="text-muted-foreground">
                      from {formatUtc(a.effective_from)}
                    </span>
                    <span className="text-muted-foreground">
                      recorded {formatUtc(a.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {consumer.status === 'active' && (
        <form
          className="flex flex-col gap-3 rounded-lg border border-border p-4"
          onSubmit={(e) => void submit(e)}
        >
          <p className="text-sm font-medium">Move to plan</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-48 flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Plan</span>
              <Select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                aria-label="Target plan"
              >
                <option value="">Default (app-wide rate cards)</option>
                {plans?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <SegmentedControl
              label="When the move takes effect"
              value={timing}
              options={[
                { key: 'next', label: 'Next minute' },
                { key: 'at', label: 'At a UTC minute' },
              ]}
              onChange={setTiming}
            />
            {timing === 'at' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Effective from (UTC)</span>
                <Input
                  type="datetime-local"
                  value={at}
                  onChange={(e) => setAt(e.target.value)}
                  aria-label="Effective from (UTC)"
                  className="w-auto"
                />
              </label>
            )}
            <Button type="submit" size="sm" disabled={!ready} busy={assign.isPending}>
              Move plan
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The move cannot start in the past, and the target plan needs a rate card in force when
            it does. Statements price each minute with the plan in force then; monthly allowances
            keep counting across the change.
          </p>
        </form>
      )}
    </div>
  );
}

// --- Usage ---------------------------------------------------------------------

const WINDOWS = [
  { key: '7', label: '7 days' },
  { key: '30', label: '30 days' },
] as const;

function ConsumerUsage({ slug, consumer }: { slug: string; consumer: Consumer }) {
  const [days, setDays] = useState<'7' | '30'>('30');
  const window = useMemo(() => trailingDays(Number(days)), [days]);
  const usage = useConsumerUsage(slug, consumer.id, window);
  const quote = useConsumerQuote(slug, consumer.id, window);
  const alerts = useUsageAlerts(slug, consumer.id);
  const tile = (q: { isPending: boolean; error: unknown }) =>
    q.isPending ? 'loading' : q.error ? 'unavailable' : 'ready';
  const alertsPhase = queryPhase({
    error: alerts.error,
    loading: alerts.isPending,
    isEmpty: alerts.data?.length === 0,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl label="Usage window" value={days} options={WINDOWS} onChange={setDays} />
        <span className="text-xs text-muted-foreground">
          {formatPeriod(window.since, window.until)}
          {usage.data && ` · as of ${formatUtc(usage.data.as_of)}`}
        </span>
      </div>
      {Boolean(usage.error ?? quote.error) && (
        <InlinePhase
          phase={queryPhase({ error: usage.error ?? quote.error })}
          error={usage.error ?? quote.error}
          onRetry={() => {
            void usage.refetch();
            void quote.refetch();
          }}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Requests"
          state={tile(usage)}
          value={usage.data?.request_count}
          format={formatCount}
        />
        <StatTile
          label="Errors"
          state={tile(usage)}
          value={usage.data?.error_count}
          format={formatCount}
        />
        <StatTile
          label="Billable units"
          state={tile(usage)}
          value={usage.data?.billable_units}
          format={formatCount}
        />
        <StatTile
          label="Quote"
          state={tile(quote)}
          value={
            quote.data ? formatMillicents(quote.data.amount_millicents, quote.data.currency) : ''
          }
          note={
            quote.data && quote.data.unpriced_units > 0
              ? `${formatCount(quote.data.unpriced_units)} units unpriced`
              : 'Estimate, not an invoice'
          }
        />
      </div>
      {quote.data && quote.data.unpriced_units > 0 && (
        <p className="text-xs text-muted-foreground">
          Usage before the first effective rate card is reported as unpriced rather than treated as
          free.
        </p>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Usage alerts</p>
        <InlinePhase
          phase={alertsPhase}
          error={alerts.error}
          loadingMessage="Loading alerts…"
          emptyMessage="No plan alert thresholds crossed."
          onRetry={() => void alerts.refetch()}
        />
        {alertsPhase === 'ready' && (
          <ul className="flex flex-col gap-1 text-sm">
            {alerts.data?.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3">
                <span className="font-medium">{a.threshold_percent}%</span>
                <span className="text-muted-foreground">
                  {formatCount(a.used_units)} of {formatCount(a.limit_units)} units in{' '}
                  {formatUtcDate(a.month_start).slice(0, 7)}
                </span>
                <span className="text-muted-foreground">crossed {formatUtc(a.crossed_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
