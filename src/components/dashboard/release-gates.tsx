import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD, FieldError, Select } from '@/components/ui/field';
import { Timestamp } from '@/components/ui/timestamp';
import { useToast } from '@/components/ui/toast';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { useAppSLOs, useAppSyntheticChecks } from '@/lib/api/alert-rules';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  AI_METRICS,
  GATES_PER_APP,
  GATE_KINDS,
  GATE_NAME,
  gateRule,
  useCreateReleaseGate,
  useDeleteReleaseGate,
  useReleaseGates,
  type CreateReleaseGate,
  type GateKind,
} from '@/lib/api/release-gates';
import { cn } from '@/lib/utils';
import { InlinePhase, Panel, queryPhase } from './primitives';

const METRIC = /^[a-z][a-z0-9_]{0,62}$/;
const kindLabel = (k: GateKind) => GATE_KINDS.find((g) => g.key === k)?.label ?? k;
const int = (v: string) => (v.trim() === '' ? undefined : Number(v));

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label-mono text-muted-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : (
        hint && <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}

/**
 * An app's release gates: the signals only the app knows about, judged on
 * every canary tick and for 30 minutes after a release reaches 100%. Removing
 * one needs the admin scope, so a deploy key cannot remove the gates it
 * deploys past. Mount it behind the `release-gates` capability.
 */
export function ReleaseGates({ slug }: { slug: string }) {
  const gates = useReleaseGates(slug);
  const stage = useCapabilityStage('release-gates');
  const remove = useDeleteReleaseGate(slug);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const list = gates.data ?? [];
  const phase = queryPhase({
    error: gates.error,
    loading: gates.isPending,
    isEmpty: list.length === 0,
  });

  const onRemove = async (name: string) => {
    const ok = await confirm({
      title: `Remove the gate ${name}?`,
      description: `Rollouts of ${slug} stop judging it, including any canary under way: a release that would have failed it can reach all traffic and is no longer rolled back for it.`,
      confirmLabel: 'Remove gate',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(name);
      toast({ kind: 'success', title: `Gate ${name} removed` });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'release_gate_not_found')
        toast({ kind: 'info', title: 'Already removed' });
      else toast({ kind: 'error', title: 'Could not remove the gate', error: err });
    }
  };

  return (
    <section aria-label="Release gates">
      <Panel
        title="Release gates"
        actions={
          !adding && (
            <Button
              size="sm"
              variant="outline"
              disabled={list.length >= GATES_PER_APP}
              title={
                list.length >= GATES_PER_APP ? `At most ${GATES_PER_APP} gates per app.` : undefined
              }
              onClick={() => setAdding(true)}
            >
              Add gate
            </Button>
          )
        }
      >
        <p className="mb-4 text-sm leading-relaxed text-muted-foreground">{`${stage ? `${stage} · ` : ''}Stop a rollout on your own signals. A failed gate aborts the canary, or rolls the release back within 30 minutes of reaching 100%. A gate without enough samples is listed as not judged and never holds a rollout.`}</p>

        <div className="flex flex-col gap-4">
          {adding && <NewGateForm slug={slug} onDone={() => setAdding(false)} />}
          {phase !== 'ready' ? (
            <InlinePhase
              phase={phase}
              error={gates.error}
              loadingMessage="Reading release gates…"
              emptyMessage={`${slug} has no release gates. Its rollouts still stop on 5xx, latency, crashes and memory.`}
              onRetry={() => void gates.refetch()}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.map((gate) => (
                <li
                  key={gate.name}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="flex flex-wrap items-center gap-x-3 text-sm">
                      <span className="font-mono font-medium">{gate.name}</span>
                      <span className="text-xs text-muted-foreground">{kindLabel(gate.kind)}</span>
                    </p>
                    <p className="text-xs">Fails on: {gateRule(gate)}</p>
                    <p className="text-xs text-muted-foreground">
                      Judged after {gate.min_samples} samples · added by {gate.created_by}{' '}
                      <Timestamp value={gate.created_at} />
                    </p>
                  </div>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => void onRemove(gate.name)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Panel>
    </section>
  );
}

/** Creates one gate; each kind sends only its own fields (releasegate.FromRequest). */
function NewGateForm({ slug, onDone }: { slug: string; onDone: () => void }) {
  const create = useCreateReleaseGate(slug);
  const { toast } = useToast();
  const [kind, setKind] = useState<GateKind>('slo');
  const [name, setName] = useState('');
  const [slo, setSlo] = useState('');
  const [burn, setBurn] = useState('10');
  const [groups, setGroups] = useState('0');
  const [events, setEvents] = useState('3');
  const [metric, setMetric] = useState('');
  const [comparison, setComparison] = useState<'below' | 'above'>('below');
  const [threshold, setThreshold] = useState('');
  const [change, setChange] = useState('30');
  const [check, setCheck] = useState('');
  const [failure, setFailure] = useState('10');
  const [ai, setAi] = useState<(typeof AI_METRICS)[number]>('error_rate');
  const [increase, setIncrease] = useState('50');
  const [samples, setSamples] = useState('');
  const [tried, setTried] = useState(false);
  const [refusal, setRefusal] = useState('');
  const slos = useAppSLOs(slug, kind === 'slo');
  const checks = useAppSyntheticChecks(slug, kind === 'synthetic');

  const range = (v: string, lo: number, hi: number) => {
    const n = Number(v);
    return v.trim() !== '' && Number.isInteger(n) && n >= lo && n <= hi;
  };
  const errors: Record<string, string | undefined> = {
    name: GATE_NAME.test(name)
      ? undefined
      : 'Lowercase letters, digits, - and _, starting with a letter.',
    samples:
      samples.trim() === '' || range(samples, 1, 1_000_000)
        ? undefined
        : 'From 1 to 1000000, or blank for the default.',
  };
  if (kind === 'slo') {
    errors.slo = slo.trim() ? undefined : 'Name one of the app’s SLOs.';
    errors.burn = range(burn, 1, 1000) ? undefined : 'From 1 to 1000.';
  }
  if (kind === 'new_errors') {
    errors.groups = range(groups, 0, 100) ? undefined : 'From 0 to 100.';
    errors.events = range(events, 1, 100_000) ? undefined : 'From 1 to 100000.';
  }
  if (kind === 'custom_metric' || kind === 'metric_change')
    errors.metric = METRIC.test(metric)
      ? undefined
      : 'A custom metric name: lowercase letters, digits and _.';
  if (kind === 'custom_metric')
    errors.threshold =
      threshold.trim() !== '' && Number.isFinite(Number(threshold)) ? undefined : 'A number.';
  if (kind === 'metric_change')
    errors.change = range(change, 1, 1000) ? undefined : 'From 1 to 1000 percent.';
  if (kind === 'synthetic') {
    errors.check = GATE_NAME.test(check) ? undefined : 'Name one of the app’s synthetic checks.';
    errors.failure = range(failure, 0, 100) ? undefined : 'From 0 to 100 percent.';
  }
  if (kind === 'ai')
    errors.increase = range(increase, 1, 1000) ? undefined : 'From 1 to 1000 percent.';
  const shown = (key: string) => (tried ? errors[key] : undefined);
  const invalid = Object.values(errors).some(Boolean);

  const body = (): CreateReleaseGate => {
    const base = { name, kind, ...(samples.trim() ? { min_samples: Number(samples) } : {}) };
    switch (kind) {
      case 'slo':
        return { ...base, slo: slo.trim(), max_burn_rate: Number(burn) };
      case 'new_errors':
        return { ...base, max_new_groups: Number(groups), min_events: Number(events) };
      case 'custom_metric':
        return { ...base, metric, comparison, threshold: Number(threshold) };
      case 'metric_change':
        return { ...base, metric, comparison, max_change_percent: Number(change) };
      case 'synthetic':
        return { ...base, check, max_failure_percent: int(failure) };
      case 'ai':
        return { ...base, metric: ai, max_increase_percent: Number(increase) };
    }
  };

  const submit = async () => {
    setTried(true);
    if (invalid || create.isPending) return;
    setRefusal('');
    try {
      const gate = await create.mutateAsync(body());
      toast({
        kind: 'success',
        title: `Gate ${gate.name} added`,
        description: 'The next rollout judges it.',
      });
      onDone();
    } catch (err) {
      setRefusal(
        err instanceof ApiError && err.code === 'release_gate_limit'
          ? `An app holds at most ${GATES_PER_APP} gates; remove one first.`
          : errorMessage(err)
      );
    }
  };

  const input = (
    id: string,
    value: string,
    set: (v: string) => void,
    extra: { type?: string; list?: string } = {}
  ) => (
    <input
      id={id}
      value={value}
      type={extra.type ?? 'text'}
      list={extra.list}
      onChange={(e) => set(e.target.value)}
      aria-invalid={Boolean(shown(id.replace('gate-', ''))) || undefined}
      aria-describedby={shown(id.replace('gate-', '')) ? `${id}-error` : undefined}
      className={cn(FIELD, 'w-full', extra.type !== 'number' && 'font-mono')}
    />
  );

  return (
    <form
      noValidate
      aria-label="New release gate"
      className="flex flex-col gap-3 well rounded-xl bg-muted/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="gate-name" label="Name" error={shown('name')}>
          {input('gate-name', name, setName)}
        </Field>
        <Field id="gate-kind" label="Kind">
          <Select id="gate-kind" value={kind} onChange={(e) => setKind(e.target.value as GateKind)}>
            {GATE_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        {GATE_KINDS.find((k) => k.key === kind)?.line}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {kind === 'slo' && (
          <>
            <Field id="gate-slo" label="SLO" error={shown('slo')}>
              {input('gate-slo', slo, setSlo, { list: 'gate-slo-options' })}
              <datalist id="gate-slo-options">
                {(slos.data ?? []).map((s) => (
                  <option key={s.id} value={s.name} />
                ))}
              </datalist>
            </Field>
            <Field
              id="gate-burn"
              label="Max burn rate"
              error={shown('burn')}
              hint="Times faster than the error budget allows."
            >
              {input('gate-burn', burn, setBurn, { type: 'number' })}
            </Field>
          </>
        )}
        {kind === 'new_errors' && (
          <>
            <Field id="gate-groups" label="New groups allowed" error={shown('groups')}>
              {input('gate-groups', groups, setGroups, { type: 'number' })}
            </Field>
            <Field id="gate-events" label="Events before a group counts" error={shown('events')}>
              {input('gate-events', events, setEvents, { type: 'number' })}
            </Field>
          </>
        )}
        {(kind === 'custom_metric' || kind === 'metric_change') && (
          <>
            <Field id="gate-metric" label="Custom metric" error={shown('metric')}>
              {input('gate-metric', metric, setMetric)}
            </Field>
            <Field
              id="gate-comparison"
              label={kind === 'custom_metric' ? 'Fails when the average is' : 'Fails when it'}
            >
              <Select
                id="gate-comparison"
                value={comparison}
                onChange={(e) => setComparison(e.target.value as 'below' | 'above')}
              >
                <option value="below">{kind === 'custom_metric' ? 'Below' : 'Drops'}</option>
                <option value="above">{kind === 'custom_metric' ? 'Above' : 'Rises'}</option>
              </Select>
            </Field>
            {kind === 'custom_metric' ? (
              <Field id="gate-threshold" label="Threshold" error={shown('threshold')}>
                {input('gate-threshold', threshold, setThreshold, { type: 'number' })}
              </Field>
            ) : (
              <Field
                id="gate-change"
                label="By more than (%)"
                error={shown('change')}
                hint="Of its average before the rollout."
              >
                {input('gate-change', change, setChange, { type: 'number' })}
              </Field>
            )}
          </>
        )}
        {kind === 'synthetic' && (
          <>
            <Field id="gate-check" label="Synthetic check" error={shown('check')}>
              {input('gate-check', check, setCheck, { list: 'gate-check-options' })}
              <datalist id="gate-check-options">
                {(checks.data ?? []).map((c) => (
                  <option key={c.id} value={c.name} />
                ))}
              </datalist>
            </Field>
            <Field id="gate-failure" label="Probes allowed to fail (%)" error={shown('failure')}>
              {input('gate-failure', failure, setFailure, { type: 'number' })}
            </Field>
          </>
        )}
        {kind === 'ai' && (
          <>
            <Field id="gate-ai" label="AI signal">
              <Select id="gate-ai" value={ai} onChange={(e) => setAi(e.target.value as typeof ai)}>
                {AI_METRICS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="gate-increase" label="Worse by more than (%)" error={shown('increase')}>
              {input('gate-increase', increase, setIncrease, { type: 'number' })}
            </Field>
          </>
        )}
        <Field
          id="gate-samples"
          label="Minimum samples"
          error={shown('samples')}
          hint={kind === 'synthetic' ? 'Blank: 6 probes.' : 'Blank: 20.'}
        >
          {input('gate-samples', samples, setSamples, { type: 'number' })}
        </Field>
      </div>
      {refusal && (
        <p role="alert" className="text-xs text-[color:var(--status-critical)]">
          {refusal}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" busy={create.isPending}>
          Add gate
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
