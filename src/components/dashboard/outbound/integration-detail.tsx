import { useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { SegmentedControl } from '@/components/dashboard/tabs';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Select } from '@/components/ui/field';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { Timestamp } from '@/components/ui/timestamp';
import { errorMessage } from '@/lib/api/errors';
import {
  outboundKey,
  putOutboundCredentialOnce,
  useDeleteOutboundIntegration,
  useDeleteOutboundProbePolicy,
  useOutboundProbePolicy,
  useOutboundUsage,
  useRevokeOutboundCredential,
  useSetOutboundBudget,
  useSetOutboundProbePolicy,
  useSetOutboundRequestPolicy,
  type OutboundIntegration,
  type OutboundRequestPolicy,
} from '@/lib/api/outbound';
import { formatNumber } from '@/lib/mock-data';
import { AI_PROVIDER_LABELS, CredentialPill, formatLimit, isCustomer } from './outbound-format';

export type DetailSection = 'overview' | 'credential' | 'limits' | 'probe';

/**
 * One integration, opened from its row. Operator-provisioned integrations
 * are read-only here: their credential, budget, and policy belong to the
 * platform operator and the write endpoints refuse them.
 */
export function IntegrationDetail({
  accountId,
  integration,
  section,
  onSection,
  onClose,
}: {
  accountId: string;
  integration: OutboundIntegration | null;
  section: DetailSection;
  onSection: (section: DetailSection) => void;
  onClose: () => void;
}) {
  const customer = integration ? isCustomer(integration) : false;
  return (
    <Modal
      open={integration !== null}
      onClose={onClose}
      title={integration?.name ?? 'Integration'}
      description={integration?.origin}
      width="max-w-2xl"
    >
      {integration && (
        <div className="flex flex-col gap-5 text-sm">
          {customer && (
            <SegmentedControl
              label="Integration settings"
              value={section}
              onChange={onSection}
              options={[
                { key: 'overview', label: 'Overview' },
                { key: 'credential', label: 'Credential' },
                { key: 'limits', label: 'Limits' },
                { key: 'probe', label: 'Probe' },
              ]}
            />
          )}
          {(!customer || section === 'overview') && (
            <Overview accountId={accountId} integration={integration} onDeleted={onClose} />
          )}
          {customer && section === 'credential' && (
            <CredentialSection accountId={accountId} integration={integration} />
          )}
          {customer && section === 'limits' && (
            <LimitsSection accountId={accountId} integration={integration} />
          )}
          {customer && section === 'probe' && (
            <ProbeSection accountId={accountId} integration={integration} />
          )}
        </div>
      )}
    </Modal>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Failure({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
      {message}
    </p>
  );
}

function Overview({
  accountId,
  integration,
  onDeleted,
}: {
  accountId: string;
  integration: OutboundIntegration;
  onDeleted: () => void;
}) {
  const usage = useOutboundUsage(accountId, integration.id);
  const remove = useDeleteOutboundIntegration(accountId);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [failure, setFailure] = useState<string | null>(null);
  const customer = isCustomer(integration);

  const destroy = async () => {
    setFailure(null);
    const ok = await confirm({
      title: `Delete ${integration.name}?`,
      description:
        'Deletes the integration, its sealed credential, every app binding, and its admission state. Apps calling it start failing immediately.',
      confirmLabel: 'Delete integration',
      destructive: true,
      typeToConfirm: integration.name,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(integration.id);
      toast({ kind: 'success', title: `Deleted ${integration.name}` });
      onDeleted();
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Facts
        rows={[
          ['Owner', customer ? 'Your account' : 'Operator-provisioned'],
          ['Status', integration.enabled ? 'Enabled' : 'Disabled'],
          ['Credential', <CredentialPill key="c" integration={integration} />],
          ['Methods', integration.allowed_methods.join(', ')],
          [
            'Path prefixes',
            <span key="p" className="font-mono text-xs">
              {integration.allowed_path_prefixes.join('  ')}
            </span>,
          ],
          ['Runs access', integration.runs_enabled ? 'Granted' : 'Not granted'],
          ...(integration.ai_provider
            ? ([['AI provider', AI_PROVIDER_LABELS[integration.ai_provider]]] as [string, string][])
            : []),
        ]}
      />
      <div className="rounded-lg border border-border p-3">
        <p className="label-mono text-muted-foreground">Requests today (UTC)</p>
        {usage.data ? (
          <p className="mt-1">
            <span className="text-lg font-semibold [font-variant-numeric:tabular-nums]">
              {formatNumber(usage.data.daily_request_count)}
            </span>{' '}
            <span className="text-muted-foreground">
              of {formatLimit(usage.data.daily_request_limit, 'requests').toLowerCase()} · resets{' '}
              <Timestamp value={usage.data.resets_at} className="font-mono text-xs" />
            </span>
          </p>
        ) : (
          <InlinePhase
            phase={queryPhase({ error: usage.error, loading: usage.isPending })}
            error={usage.error}
            onRetry={() => void usage.refetch()}
          />
        )}
      </div>
      {customer ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <Failure message={failure} />
          <div>
            <Button
              variant="destructive"
              size="sm"
              disabled={remove.isPending}
              onClick={() => void destroy()}
            >
              Delete integration…
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Operator-provisioned: its credential, budget, and policies are managed by the platform
          operator and cannot be changed here.
        </p>
      )}
    </div>
  );
}

/**
 * Write-only by construction. The value lives in this component's state only
 * until the PUT settles, is cleared on success, and is never rendered back —
 * not in a toast, not in the cache (the call bypasses TanStack mutations).
 */
function CredentialSection({
  accountId,
  integration,
}: {
  accountId: string;
  integration: OutboundIntegration;
}) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { toast } = useToast();
  const revoke = useRevokeOutboundCredential(accountId);
  const configured = integration.credential_configured;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    if (!value) return setFailure('Enter the Authorization header value.');
    if (
      configured &&
      !(await confirm({
        title: 'Replace the current credential?',
        description:
          'The new value takes effect on the next gateway call. The old one is discarded and cannot be recovered.',
        confirmLabel: 'Rotate credential',
      }))
    )
      return;
    setSaving(true);
    try {
      await putOutboundCredentialOnce(integration.id, value);
      setValue('');
      toast({ kind: 'success', title: configured ? 'Credential rotated' : 'Credential saved' });
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ queryKey: outboundKey(accountId) });
    }
  };

  const revokeNow = async () => {
    setFailure(null);
    const ok = await confirm({
      title: `Revoke the ${integration.name} credential?`,
      description: 'Gateway calls through this integration fail closed until a new one is set.',
      confirmLabel: 'Revoke credential',
      destructive: true,
    });
    if (!ok) return;
    try {
      await revoke.mutateAsync(integration.id);
      toast({ kind: 'success', title: 'Credential revoked' });
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <p role="status" className="text-muted-foreground">
        {configured
          ? 'A credential is set. It is sealed at rest and is never shown again — rotate it to replace it.'
          : 'No credential is set. Gateway calls through this integration fail closed until one is.'}
      </p>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3" autoComplete="off">
        <FormField
          id="outbound-credential"
          label={configured ? 'New Authorization value' : 'Authorization value'}
          hint="The full header value the provider expects, such as Bearer sk-…. Write-only."
        >
          {(props) => (
            <Input
              {...props}
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              maxLength={8192}
            />
          )}
        </FormField>
        <Failure message={failure} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={saving}>
            {configured ? 'Rotate credential' : 'Save credential'}
          </Button>
          {configured && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={revoke.isPending}
              onClick={() => void revokeNow()}
            >
              Revoke…
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

const POLICY_FIELDS: {
  key: keyof OutboundRequestPolicy;
  label: string;
  min: number;
  max: number;
  step?: string;
  hint?: string;
}[] = [
  { key: 'rate_per_second', label: 'Requests per second', min: 0, max: 500, step: 'any' },
  { key: 'burst', label: 'Burst', min: 1, max: 2000 },
  { key: 'max_in_flight', label: 'Max in flight', min: 1, max: 1000 },
  { key: 'request_timeout_ms', label: 'Timeout (ms)', min: 1, max: 300_000 },
  {
    key: 'max_retries',
    label: 'Retries (GET/HEAD)',
    min: 0,
    max: 2,
    hint: 'Extra attempts for bodyless safe requests.',
  },
  { key: 'response_cache_ttl_seconds', label: 'Response cache (s)', min: 0, max: 300 },
  {
    key: 'circuit_breaker_failure_threshold',
    label: 'Breaker failure threshold',
    min: 0,
    max: 20,
    hint: 'Zero disables the breaker.',
  },
  { key: 'circuit_breaker_open_seconds', label: 'Breaker open (s)', min: 0, max: 300 },
  { key: 'retry_budget_per_minute', label: 'Retry budget per minute', min: 0, max: 3000 },
];

function policyErrors(draft: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of POLICY_FIELDS) {
    const raw = draft[field.key] ?? '';
    const n = Number(raw);
    const integer = field.step !== 'any';
    if (raw.trim() === '' || !Number.isFinite(n) || (integer && !Number.isInteger(n)))
      errors[field.key] = integer ? 'Enter a whole number.' : 'Enter a number.';
    else if (
      field.key === 'rate_per_second' ? n <= 0 || n > field.max : n < field.min || n > field.max
    )
      errors[field.key] =
        field.key === 'rate_per_second'
          ? `Above 0, up to ${field.max}.`
          : `From ${field.min} to ${formatNumber(field.max)}.`;
  }
  const threshold = Number(draft.circuit_breaker_failure_threshold);
  const open = Number(draft.circuit_breaker_open_seconds);
  if (!errors.circuit_breaker_open_seconds && (threshold === 0) !== (open === 0))
    errors.circuit_breaker_open_seconds =
      'Set together with a nonzero failure threshold, or both 0.';
  return errors;
}

function LimitsSection({
  accountId,
  integration,
}: {
  accountId: string;
  integration: OutboundIntegration;
}) {
  const { toast } = useToast();
  const budget = useSetOutboundBudget(accountId);
  const policy = useSetOutboundRequestPolicy(accountId);
  const [limit, setLimit] = useState(integration.daily_request_limit?.toString() ?? '');
  const [budgetFailure, setBudgetFailure] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      POLICY_FIELDS.map((f) => [f.key, String(integration.request_policy[f.key] ?? 0)])
    )
  );
  const [policyAttempted, setPolicyAttempted] = useState(false);
  const [policyFailure, setPolicyFailure] = useState<string | null>(null);
  const errors = policyErrors(draft);

  const limitValue = limit.trim() === '' ? null : Number(limit);
  const limitError =
    limitValue !== null &&
    (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100_000_000)
      ? 'Enter a whole number from 1 to 100,000,000, or leave empty for no limit.'
      : undefined;

  const saveBudget = async (e: FormEvent) => {
    e.preventDefault();
    setBudgetFailure(null);
    if (limitError) return;
    try {
      await budget.mutateAsync({ id: integration.id, limit: limitValue });
      toast({ kind: 'success', title: 'Daily limit saved' });
    } catch (error) {
      setBudgetFailure(errorMessage(error));
    }
  };

  const savePolicy = async (e: FormEvent) => {
    e.preventDefault();
    setPolicyAttempted(true);
    setPolicyFailure(null);
    if (Object.keys(errors).length) return;
    const next = Object.fromEntries(
      POLICY_FIELDS.map((f) => [f.key, Number(draft[f.key])])
    ) as unknown as OutboundRequestPolicy;
    try {
      await policy.mutateAsync({ id: integration.id, policy: next });
      toast({ kind: 'success', title: 'Request policy saved' });
    } catch (error) {
      setPolicyFailure(errorMessage(error));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={(e) => void saveBudget(e)} className="flex flex-col gap-3" noValidate>
        <FormField
          id="outbound-daily-limit"
          label="Daily request limit"
          hint="Admitted requests per UTC day. Leave empty for no limit; your plan's ceiling still applies."
          error={limitError}
          showError={Boolean(limit)}
        >
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="max-w-48"
            />
          )}
        </FormField>
        <Failure message={budgetFailure} />
        <div>
          <Button type="submit" size="sm" disabled={budget.isPending || Boolean(limitError)}>
            Save limit
          </Button>
        </div>
      </form>
      <form
        onSubmit={(e) => void savePolicy(e)}
        className="flex flex-col gap-3 border-t border-border pt-5"
        noValidate
      >
        <p className="label-mono text-muted-foreground">Request policy</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {POLICY_FIELDS.map((field) => (
            <FormField
              key={field.key}
              id={`outbound-policy-${field.key}`}
              label={field.label}
              hint={field.hint}
              error={errors[field.key]}
              showError={policyAttempted}
            >
              {(props) => (
                <Input
                  {...props}
                  inputMode={field.step === 'any' ? 'decimal' : 'numeric'}
                  value={draft[field.key]}
                  onChange={(e) => setDraft({ ...draft, [field.key]: e.target.value })}
                />
              )}
            </FormField>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Every value must fit your plan&apos;s ceiling. Changes apply to new admissions; calls
          already admitted keep their deadline.
        </p>
        <Failure message={policyFailure} />
        <div>
          <Button type="submit" size="sm" disabled={policy.isPending}>
            Save policy
          </Button>
        </div>
      </form>
    </div>
  );
}

function ProbeSection({
  accountId,
  integration,
}: {
  accountId: string;
  integration: OutboundIntegration;
}) {
  const probe = useOutboundProbePolicy(accountId, integration.id);
  if (probe.data === undefined) {
    return (
      <InlinePhase
        phase={queryPhase({ error: probe.error, loading: probe.isPending })}
        error={probe.error}
        loadingMessage="Reading probe policy…"
        onRetry={() => void probe.refetch()}
      />
    );
  }
  return (
    <ProbeForm
      key={probe.data ? `${probe.data.method} ${probe.data.path}` : 'none'}
      accountId={accountId}
      integration={integration}
      current={probe.data}
    />
  );
}

function ProbeForm({
  accountId,
  integration,
  current,
}: {
  accountId: string;
  integration: OutboundIntegration;
  current: { method: 'GET' | 'HEAD'; path: string; expected_status: number } | null;
}) {
  const methods = (['GET', 'HEAD'] as const).filter((m) => integration.allowed_methods.includes(m));
  const [method, setMethod] = useState<'GET' | 'HEAD'>(current?.method ?? methods[0] ?? 'GET');
  const [path, setPath] = useState(current?.path ?? integration.allowed_path_prefixes[0] ?? '/');
  const [status, setStatus] = useState(String(current?.expected_status ?? 200));
  const [failure, setFailure] = useState<string | null>(null);
  const set = useSetOutboundProbePolicy(accountId);
  const remove = useDeleteOutboundProbePolicy(accountId);
  const confirm = useConfirm();
  const { toast } = useToast();
  const statusValue = Number(status);
  const statusError =
    !Number.isInteger(statusValue) || statusValue < 200 || statusValue > 299
      ? 'Enter a 2xx status.'
      : undefined;

  if (!methods.length) {
    return (
      <p className="text-muted-foreground">
        A probe needs GET or HEAD, and this integration allows neither.
      </p>
    );
  }

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    if (statusError || !path.startsWith('/')) return;
    try {
      await set.mutateAsync({
        id: integration.id,
        policy: { method, path, expected_status: statusValue },
      });
      toast({ kind: 'success', title: 'Probe saved' });
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  const clear = async () => {
    setFailure(null);
    const ok = await confirm({
      title: 'Remove the probe?',
      description: 'Prior probe evidence is invalidated. The provider credential is not affected.',
      confirmLabel: 'Remove probe',
      destructive: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(integration.id);
      toast({ kind: 'success', title: 'Probe removed' });
    } catch (error) {
      setFailure(errorMessage(error));
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3" noValidate>
      <p role="status" className="text-muted-foreground">
        {current
          ? `Probing ${current.method} ${current.path}, expecting ${current.expected_status}.`
          : 'No probe is configured.'}{' '}
        Saving a probe sends no traffic to the provider.
      </p>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_8rem]">
        <FormField id="probe-method" label="Method">
          {(props) => (
            <Select
              {...props}
              value={method}
              onChange={(e) => setMethod(e.target.value as 'GET' | 'HEAD')}
            >
              {methods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField
          id="probe-path"
          label="Path"
          hint="Must fall under an allowed path prefix; no query string."
          error={path.startsWith('/') ? undefined : 'Start the path with /.'}
          showError
        >
          {(props) => (
            <Input
              {...props}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              spellCheck={false}
              className="font-mono"
            />
          )}
        </FormField>
        <FormField id="probe-status" label="Expected status" error={statusError} showError>
          {(props) => (
            <Input
              {...props}
              inputMode="numeric"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            />
          )}
        </FormField>
      </div>
      <Failure message={failure} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={set.isPending}>
          Save probe
        </Button>
        {current && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={remove.isPending}
            onClick={() => void clear()}
          >
            Remove…
          </Button>
        )}
      </div>
    </form>
  );
}
