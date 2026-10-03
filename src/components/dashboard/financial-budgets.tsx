import { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD, Select } from '@/components/ui/field';
import { Modal } from '@/components/ui/modal';
import { errorMessage } from '@/lib/api/errors';
import {
  financialMoney,
  parseFinancialMoney,
  useBudgetProjects,
  useBudgetEnvironments,
  useFinancialBudgets,
  useFinancialBudgetPreview,
  useFinancialBudgetHistory,
  useSaveFinancialBudget,
  useDeleteFinancialBudget,
  type FinancialBudget,
  type FinancialBudgetSpec,
} from '@/lib/api/financial';
import { useApps, useInfiniteJobs, useJobs } from '@/lib/api/queries';
import { InlinePhase, Panel, queryPhase } from './primitives';

const actions: Record<FinancialBudgetSpec['action'], string> = {
  notify: 'Only notify',
  reject_traffic: 'Reject new traffic',
  stop_previews: 'Stop previews',
  suspend_background: 'Suspend background workloads',
  suspend_workloads: 'Suspend all covered workloads',
};

export function FinancialBudgetsPanel() {
  const query = useFinancialBudgets();
  const remove = useDeleteFinancialBudget();
  const [editor, setEditor] = useState<FinancialBudget | 'new' | null>(null);
  const [history, setHistory] = useState('');
  const [message, setMessage] = useState('');
  const deletionKey = useRef<{ id: string; revision: number; key: string } | null>(null);
  const phase = queryPhase({ error: query.error, loading: query.isPending });
  return (
    <Panel
      title="Scoped budgets"
      description="Plan a spending response for an account, project, environment, application or job."
      actions={
        <Button size="sm" onClick={() => setEditor('new')}>
          New budget draft
        </Button>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Budget activation is unavailable on this deployment. Saved drafts do not stop usage or send
        spending notifications.
      </p>
      {message && (
        <p role="status" className="mb-3 text-sm">
          {message}
        </p>
      )}
      {remove.error && (
        <p role="alert" className="mb-3 text-sm">
          {errorMessage(remove.error)}
        </p>
      )}
      {phase !== 'ready' ? (
        <InlinePhase
          phase={phase}
          error={query.error}
          loadingMessage="Reading budget policies…"
          onRetry={() => void query.refetch()}
        />
      ) : query.data?.budgets.length ? (
        <ul className="flex flex-col gap-3">
          {query.data.budgets.map((budget) => (
            <li key={budget.id} className="rounded border border-border p-3">
              <p className="text-sm font-medium">{budget.spec.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {financialMoney(budget.spec.limit_millicents)} · {budget.spec.scope.kind} ·{' '}
                {actions[budget.spec.action]} · {budget.status} · Revision {budget.revision}
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="xs" variant="ghost" onClick={() => setEditor(budget)}>
                  Edit {budget.spec.name}
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setHistory(budget.id)}>
                  History
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => {
                    const previous = deletionKey.current;
                    const key =
                      previous?.id === budget.id && previous.revision === budget.revision
                        ? previous.key
                        : crypto.randomUUID();
                    deletionKey.current = { id: budget.id, revision: budget.revision, key };
                    remove.mutate(
                      { budget, key },
                      {
                        onSuccess: () => {
                          setMessage(
                            `${budget.spec.name} deleted. Its revision history is retained.`
                          );
                          deletionKey.current = null;
                          setHistory(budget.id);
                        },
                      }
                    );
                  }}
                >
                  Delete draft
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No budget drafts saved.</p>
      )}
      {editor && (
        <Modal
          open
          onClose={() => setEditor(null)}
          title={editor === 'new' ? 'New budget draft' : 'Edit budget draft'}
          width="max-w-2xl"
        >
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-1">
            <BudgetEditor
              budget={editor === 'new' ? undefined : editor}
              onSaved={(budget) => {
                setMessage(
                  `${budget.spec.name} saved as a draft. Spending protection is unavailable.`
                );
                setEditor(null);
              }}
            />
          </div>
        </Modal>
      )}
      {history && (
        <Modal
          open
          onClose={() => setHistory('')}
          title="Budget revision history"
          width="max-w-2xl"
        >
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-1">
            <BudgetHistory id={history} />
          </div>
        </Modal>
      )}
    </Panel>
  );
}

function BudgetEditor({
  budget,
  onSaved,
}: {
  budget?: FinancialBudget;
  onSaved: (budget: FinancialBudget) => void;
}) {
  const initial = budget?.spec;
  const [name, setName] = useState(initial?.name ?? '');
  const [scope, setScope] = useState<FinancialBudgetSpec['scope']['kind']>(
    initial?.scope.kind ?? 'account'
  );
  const [resource, setResource] = useState(initial?.scope.id ?? '');
  const [projectSlug, setProjectSlug] = useState('');
  const [amount, setAmount] = useState(
    initial ? financialMoney(initial.limit_millicents).replace('EUR ', '') : '10.00'
  );
  const [thresholds, setThresholds] = useState(
    initial?.notify_millicents.map((n) => financialMoney(n).replace('EUR ', '')).join(', ') ??
      '8.00'
  );
  const [basis, setBasis] = useState<FinancialBudgetSpec['basis']>(initial?.basis ?? 'net_usage');
  const [mode, setMode] = useState<FinancialBudgetSpec['mode']>(initial?.mode ?? 'monitored');
  const [action, setAction] = useState<FinancialBudgetSpec['action']>(
    initial?.action ?? 'stop_previews'
  );
  const [egress, setEgress] = useState(initial?.meters.includes('egress') ?? false);
  const [drain, setDrain] = useState(String(initial?.drain_seconds ?? 30));
  const [resume, setResume] = useState<FinancialBudgetSpec['resume_rule']>(
    initial?.resume_rule ?? 'manual'
  );
  const [error, setError] = useState('');
  const preview = useFinancialBudgetPreview();
  const save = useSaveFinancialBudget();
  const operation = useRef<{ fingerprint: string; key: string } | null>(null);
  const prefix = useId();
  const apps = useApps({ enabled: scope === 'app' });
  const jobs = useInfiniteJobs(50, scope === 'job');
  const selectedJob = useJobs(resource || undefined, scope === 'job' && !!resource);
  const projects = useBudgetProjects(scope === 'project' || scope === 'environment');
  const environments = useBudgetEnvironments(scope === 'environment' ? projectSlug : '');
  const options =
    scope === 'app'
      ? (apps.data ?? []).map((a) => ({ id: a.id, name: a.slug }))
      : scope === 'project'
        ? (projects.data ?? []).map((p) => ({ id: p.id, name: p.slug }))
        : scope === 'environment'
          ? (environments.data ?? []).map((e) => ({ id: e.id, name: e.slug }))
          : [
              ...new Map(
                [
                  ...(jobs.data?.pages.flatMap((page) => page.jobs) ?? []),
                  ...(selectedJob.data?.jobs ?? []),
                ].map((job) => [job.id, { id: job.id, name: job.name }])
              ).values(),
            ];

  function proposedSpec(): FinancialBudgetSpec | undefined {
    const limit = parseFinancialMoney(amount);
    const notifications = thresholds.trim() ? thresholds.split(',').map(parseFinancialMoney) : [];
    const seconds = Number(drain);
    if (!name.trim() || new TextEncoder().encode(name).length > 128) {
      setError('Use a nonblank budget name of at most 128 bytes.');
      return;
    }
    if (scope !== 'account' && !resource) {
      setError('Choose the workload or resource covered by this budget.');
      return;
    }
    if (limit === undefined || notifications.some((n) => n === undefined)) {
      setError('Enter nonnegative EUR amounts with up to five decimal places.');
      return;
    }
    const notify = notifications as number[];
    if (notify.length > 8 || notify.some((n, i) => n > limit || (i > 0 && n <= notify[i - 1]))) {
      setError('Use up to eight increasing notification amounts at or below the limit.');
      return;
    }
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 300 || drain.trim() === '') {
      setError('Choose a drain time between 0 and 300 seconds.');
      return;
    }
    if (scope === 'job' && (action === 'reject_traffic' || action === 'stop_previews')) {
      setError('Jobs require notification or a workload suspension response.');
      return;
    }
    if (
      mode === 'strict' &&
      (egress ||
        action === 'notify' ||
        action === 'reject_traffic' ||
        (scope !== 'account' && basis !== 'gross_usage') ||
        (scope !== 'app' && scope !== 'job' && action !== 'suspend_workloads'))
    ) {
      setError(
        'Strict drafts cover compute, use a stopping response, use gross cost for resource scopes, and suspend every workload in broad scopes.'
      );
      return;
    }
    setError('');
    return {
      name,
      scope: scope === 'account' ? { kind: scope } : { kind: scope, id: resource },
      currency: 'EUR',
      meters: egress ? ['compute', 'egress'] : ['compute'],
      basis,
      limit_millicents: limit,
      notify_millicents: notify,
      mode,
      action,
      drain_seconds: action === 'notify' ? 0 : seconds,
      resume_rule: resume,
      enabled: true,
    };
  }

  // A completed preview is shown only while its intent still matches this form.
  const currentLimit = parseFinancialMoney(amount);
  const observation = preview.data;
  const matches =
    observation &&
    observation.spec.name === name &&
    observation.spec.scope.kind === scope &&
    (observation.spec.scope.id ?? '') === (scope === 'account' ? '' : resource) &&
    observation.spec.limit_millicents === currentLimit &&
    observation.spec.basis === basis &&
    observation.spec.mode === mode &&
    observation.spec.action === action &&
    observation.spec.drain_seconds === (action === 'notify' ? 0 : Number(drain)) &&
    observation.spec.resume_rule === resume &&
    observation.spec.meters.includes('egress') === egress &&
    JSON.stringify(observation.spec.notify_millicents) ===
      JSON.stringify(thresholds.trim() ? thresholds.split(',').map(parseFinancialMoney) : []);
  const resourceQuery =
    scope === 'app'
      ? apps
      : scope === 'project'
        ? projects
        : scope === 'environment'
          ? environments
          : jobs;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const proposed = proposedSpec();
        if (!proposed) return;
        const spec = { ...proposed, enabled: false };
        const fingerprint = JSON.stringify({ spec, id: budget?.id, revision: budget?.revision });
        const key =
          operation.current?.fingerprint === fingerprint
            ? operation.current.key
            : crypto.randomUUID();
        operation.current = { fingerprint, key };
        save.mutate({ budget, spec, key }, { onSuccess: onSaved });
      }}
    >
      <p className="text-sm text-muted-foreground">
        Preview the proposed response, then save a disabled draft. Activation is unavailable; no
        workload will stop and no notification will be sent.
      </p>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${prefix}-name`}>
        Budget name
        <input
          id={`${prefix}-name`}
          className={FIELD}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${prefix}-scope`}>
        Scope
        <Select
          id={`${prefix}-scope`}
          value={scope}
          onChange={(e) => {
            setScope(e.target.value as typeof scope);
            setResource('');
            setProjectSlug('');
          }}
        >
          <option value="account">Account</option>
          <option value="project">Project</option>
          <option value="environment">Environment</option>
          <option value="app">Application</option>
          <option value="job">Job</option>
        </Select>
      </label>
      {scope === 'environment' && (
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${prefix}-project`}>
          Project
          <Select
            id={`${prefix}-project`}
            value={projectSlug}
            onChange={(e) => {
              setProjectSlug(e.target.value);
              setResource('');
            }}
          >
            <option value="">Choose a project</option>
            {projects.data?.map((p) => (
              <option key={p.id} value={p.slug}>
                {p.slug}
              </option>
            ))}
          </Select>
          {projects.error && <p role="alert">{errorMessage(projects.error)}</p>}
        </label>
      )}
      {scope !== 'account' && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${prefix}-resource`}>
            Covered {scope}
            <Select
              id={`${prefix}-resource`}
              value={resource}
              onChange={(e) => setResource(e.target.value)}
            >
              <option value="">Choose a {scope}</option>
              {resource && !options.some((o) => o.id === resource) && (
                <option value={resource}>Current saved scope</option>
              )}
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </label>
          {!!resourceQuery.error && <p role="alert">{errorMessage(resourceQuery.error)}</p>}
          {scope === 'job' && jobs.hasNextPage && (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              disabled={jobs.isFetchingNextPage}
              onClick={() => void jobs.fetchNextPage()}
            >
              Load more jobs
            </Button>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${prefix}-limit`}>
          Monthly limit (EUR)
          <input
            id={`${prefix}-limit`}
            inputMode="decimal"
            className={FIELD}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${prefix}-thresholds`}>
          Notify at (EUR, comma separated)
          <input
            id={`${prefix}-thresholds`}
            className={FIELD}
            value={thresholds}
            onChange={(e) => setThresholds(e.target.value)}
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${prefix}-basis`}>
        Cost basis
        <Select
          id={`${prefix}-basis`}
          value={basis}
          onChange={(e) => setBasis(e.target.value as typeof basis)}
        >
          <option value="net_usage">Usage after the shared account allowance</option>
          <option value="gross_usage">Usage before the account allowance</option>
        </Select>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={egress} onChange={(e) => setEgress(e.target.checked)} />
        Include interface egress with compute
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${prefix}-mode`}>
        Limit mode
        <Select
          id={`${prefix}-mode`}
          value={mode}
          onChange={(e) => setMode(e.target.value as typeof mode)}
        >
          <option value="monitored">Monitored spending threshold</option>
          <option value="strict">Strict compute ceiling (unavailable)</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${prefix}-action`}>
        Response at the limit
        <Select
          id={`${prefix}-action`}
          value={action}
          onChange={(e) => setAction(e.target.value as typeof action)}
        >
          {Object.entries(actions).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </label>
      <p className="text-xs text-muted-foreground">
        Monitored checks and drain time can allow spending beyond the threshold. Rejecting traffic
        leaves resident and background compute running. Preview and background responses allow other
        covered production work to continue.
      </p>
      {action !== 'notify' && (
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${prefix}-drain`}>
          Drain deadline (seconds)
          <input
            id={`${prefix}-drain`}
            type="number"
            min="0"
            max="300"
            className={FIELD}
            value={drain}
            onChange={(e) => setDrain(e.target.value)}
          />
        </label>
      )}
      <label className="flex flex-col gap-1 text-sm" htmlFor={`${prefix}-resume`}>
        Resume rule
        <Select
          id={`${prefix}-resume`}
          value={resume}
          onChange={(e) => setResume(e.target.value as typeof resume)}
        >
          <option value="manual">Wait for a manual policy change</option>
          <option value="next_period">Resume next UTC usage month</option>
        </Select>
      </label>
      {(error || save.error || preview.error) && (
        <p role="alert" className="text-sm">
          {error || errorMessage(save.error ?? preview.error)}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={preview.isPending || save.isPending}
          onClick={() => {
            const spec = proposedSpec();
            if (spec) preview.mutate(spec);
          }}
        >
          {preview.isPending ? 'Previewing…' : 'Preview response'}
        </Button>
        <Button type="submit" disabled={save.isPending || preview.isPending}>
          {save.isPending ? 'Saving…' : 'Save disabled draft'}
        </Button>
      </div>
      {matches && observation && (
        <div
          className="rounded border border-border p-3 text-sm"
          aria-label="Budget response preview"
        >
          <p>
            Known cost: {financialMoney(observation.known_millicents)} /{' '}
            {financialMoney(observation.spec.limit_millicents)}.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {observation.coverage_complete
              ? 'Complete coverage.'
              : 'Partial coverage; the known amount can omit costs.'}{' '}
            {observation.fresh ? '' : 'Usage reports are delayed.'} Enforcement is unavailable.
          </p>
          <p className="mt-3 font-medium">Affected workloads</p>
          {observation.targets.length ? (
            <ul>
              {observation.targets.map((target) => (
                <li key={`${target.kind}:${target.id}:${target.deployment_id ?? ''}`}>
                  {target.name} · {actions[action]}
                </li>
              ))}
            </ul>
          ) : (
            <p>No current workloads selected.</p>
          )}
          <p className="mt-3 font-medium">Workloads that can continue spending</p>
          {observation.continuing_targets.length ? (
            <ul>
              {observation.continuing_targets.map((target) => (
                <li key={`${target.kind}:${target.id}:${target.deployment_id ?? ''}`}>
                  {target.name}
                </li>
              ))}
            </ul>
          ) : (
            <p>No continuing workloads reported in this scope.</p>
          )}
        </div>
      )}
    </form>
  );
}

function BudgetHistory({ id }: { id: string }) {
  const [after, setAfter] = useState(0);
  const query = useFinancialBudgetHistory(id, after);
  const phase = queryPhase({ error: query.error, loading: query.isPending });
  if (phase !== 'ready')
    return (
      <InlinePhase
        phase={phase}
        error={query.error}
        loadingMessage="Reading revision history…"
        onRetry={() => void query.refetch()}
      />
    );
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Intent changes are audited. This history does not establish that a workload stopped.
      </p>
      {query.data?.revisions.map((revision) => (
        <div key={revision.revision} className="rounded border border-border p-3 text-sm">
          <p>
            Revision {revision.revision} · {revision.mutation} · {revision.spec.name}
          </p>
          <p>
            {financialMoney(revision.spec.limit_millicents)} · {actions[revision.spec.action]}
          </p>
          <p className="text-xs text-muted-foreground">
            {revision.actor} · {new Date(revision.recorded_at).toLocaleString()}
          </p>
        </div>
      ))}
      {!query.data?.revisions.length && <p>No more revisions.</p>}
      <div className="flex gap-2">
        {after > 0 && (
          <Button size="xs" variant="ghost" onClick={() => setAfter(0)}>
            First revisions
          </Button>
        )}
        {query.data?.next_revision && (
          <Button size="xs" variant="ghost" onClick={() => setAfter(query.data!.next_revision!)}>
            Next revisions
          </Button>
        )}
      </div>
    </div>
  );
}
