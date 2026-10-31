import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FIELD } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  LoadingState,
  Panel,
  UnreachableState,
  queryPhase,
} from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { Timestamp } from '@/components/dashboard/events/event-format';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useAppOutboundBindings,
  useBindOutboundIntegration,
  useOutboundIntegrations,
  useUnbindOutboundIntegration,
  type OutboundAppBinding,
  type OutboundIntegration,
} from '@/lib/api/outbound';
import { useAuth } from '@/lib/auth';
import { formatNumber } from '@/lib/mock-data';
import { AI_PROVIDER_LABELS, CredentialPill } from './outbound-format';

const CREDENTIAL_CAVEAT =
  'It will not serve traffic until a credential is set on the Integrations page.';

/** A customer-sealed integration only serves traffic once someone has sealed a credential. */
const needsCredential = (integration: OutboundIntegration) =>
  integration.credential_source === 'customer_sealed' && !integration.credential_configured;

/**
 * Owner and credential are separate facts. An operator-provisioned integration
 * is meant to be bound by customers (ADR-252); the badge says whose it is. The
 * credential pill already says "Operator-managed" for an operator-supplied
 * key, so it is dropped when the owner badge would only repeat it.
 */
const operatorOwned = (integration: OutboundIntegration) => integration.owner_kind === 'operator';
const showsCredentialPill = (integration: OutboundIntegration) =>
  !(operatorOwned(integration) && integration.credential_source === 'operator_env');

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="label-mono text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children}</dd>
    </div>
  );
}

function BindingRow({
  binding,
  busy,
  onUnbind,
}: {
  binding: OutboundAppBinding;
  busy: boolean;
  onUnbind: () => void;
}) {
  const { integration } = binding;
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{integration.name}</h3>
            {integration.ai_provider && (
              <Pill label={`AI · ${AI_PROVIDER_LABELS[integration.ai_provider]}`} />
            )}
            {operatorOwned(integration) && <Pill label="Operator-managed" />}
            {showsCredentialPill(integration) && <CredentialPill integration={integration} />}
            {!integration.enabled && (
              <Pill label="Integration disabled" color="var(--status-warning)" />
            )}
          </div>
          <p className="mt-0.5 break-all text-xs text-muted-foreground">{integration.origin}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          busy={busy}
          aria-label={`Unbind ${integration.name}`}
          onClick={onUnbind}
        >
          <Trash className="h-3.5 w-3.5" />
          Unbind
        </Button>
      </div>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Methods">{binding.allowed_methods.join(', ') || '—'}</Fact>
        <Fact label="Path prefixes">
          <span className="font-mono text-xs">
            {binding.allowed_path_prefixes.join('  ') || '—'}
          </span>
        </Fact>
        <Fact label="Daily limit">
          {binding.daily_request_limit == null
            ? 'No app-specific limit'
            : `${formatNumber(binding.daily_request_limit)} requests per day`}
          {binding.ai_daily_token_limit != null && (
            <span className="block">
              {formatNumber(binding.ai_daily_token_limit)} tokens per day
            </span>
          )}
        </Fact>
        <Fact label="Bound">
          <Timestamp iso={binding.created_at} />
        </Fact>
      </dl>
      {needsCredential(integration) && (
        <p className="text-sm" style={{ color: 'var(--status-warning)' }}>
          This integration has no credential, so it will not serve traffic until a credential is set
          on the{' '}
          <Link to="/dashboard/integrations" className="underline underline-offset-4">
            Integrations page
          </Link>
          .
        </p>
      )}
    </li>
  );
}

/**
 * The managed outbound integrations one app is attached to (`outbound` tag).
 *
 * The integrations themselves are account-wide and live on the Integrations
 * page; this is the per-app half — which of them this app may reach. Binding
 * and unbinding touch only the attachment: the integration, its sealed
 * credential and every other app's binding are left as they are. Both calls
 * are MFA-gated (`requireMFA`); the global `mfa_required` handling in the API
 * client prompts for it, so this component does not. Both are idempotent by
 * resource.
 *
 * The spec does not say how application code addresses a bound integration, so
 * this page does not either.
 */
export function AppOutboundBindings({ slug }: { slug: string }) {
  const accountId = useAuth().account?.id ?? '';
  const { toast } = useToast();
  const confirm = useConfirm();
  const bindings = useAppOutboundBindings(accountId, slug);
  const integrations = useOutboundIntegrations(accountId);
  const bind = useBindOutboundIntegration(accountId, slug);
  const unbind = useUnbindOutboundIntegration(accountId, slug);
  const [choice, setChoice] = useState('');
  const [unbinding, setUnbinding] = useState<string | null>(null);

  const bound = new Set((bindings.data ?? []).map((b) => b.integration.id));
  const available = (integrations.data ?? []).filter((i) => i.enabled && !bound.has(i.id));
  const bindingsPhase = queryPhase({
    error: bindings.error,
    loading: bindings.isPending,
    isEmpty: bindings.data?.length === 0,
  });
  const integrationsPhase = queryPhase({
    error: integrations.error,
    loading: integrations.isPending,
    isEmpty: integrations.data?.length === 0,
  });

  const onBind = async () => {
    if (!choice || bind.isPending) return;
    try {
      const created = await bind.mutateAsync(choice);
      setChoice('');
      toast({
        kind: 'success',
        title: `${slug} is bound to ${created.integration.name}`,
        description: needsCredential(created.integration) ? CREDENTIAL_CAVEAT : undefined,
      });
    } catch (err) {
      // The integration was deleted since this list loaded: reread it so the
      // select stops offering it.
      if (err instanceof ApiError && err.code === 'not_found') void integrations.refetch();
      toast({ kind: 'error', title: 'Could not bind', description: errorMessage(err) });
    }
  };

  const onUnbind = async (binding: OutboundAppBinding) => {
    const { id, name } = binding.integration;
    const ok = await confirm({
      title: `Unbind ${name} from ${slug}?`,
      description: `${slug} stops being able to call ${name} through the gateway. The integration itself, its credential and other apps' bindings stay as they are. This app's own limits on the binding (narrowed methods and paths, daily request and AI token limits, AI guardrails) are discarded; binding it again starts from the integration's defaults.`,
      confirmLabel: 'Unbind',
      destructive: true,
      typeToConfirm: name,
    });
    if (!ok) return;
    setUnbinding(id);
    try {
      await unbind.mutateAsync(id);
      toast({ kind: 'success', title: `${slug} is no longer bound to ${name}` });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not unbind', description: errorMessage(err) });
    } finally {
      setUnbinding(null);
    }
  };

  return (
    <Panel
      title="Outbound integrations"
      description="Fixed destinations this app may call through the gateway. Binding attaches the app to an integration available to your account; it never carries a provider key."
      actions={
        <Link
          to="/dashboard/integrations"
          className="text-xs text-brand underline-offset-4 hover:underline"
        >
          Manage integrations
        </Link>
      }
    >
      <div className="flex flex-col gap-6">
        {bindingsPhase === 'unreachable' ? (
          <UnreachableState onRetry={() => void bindings.refetch()} />
        ) : bindingsPhase === 'loading' ? (
          <LoadingState message="Loading outbound integrations…" />
        ) : bindingsPhase === 'error' ? (
          <ErrorState error={bindings.error} onRetry={() => void bindings.refetch()} />
        ) : bindingsPhase === 'empty' ? (
          integrationsPhase === 'empty' ? (
            <EmptyState
              message="No integrations in this account yet. Create one, then bind this app to it."
              action={
                <Link
                  to="/dashboard/integrations"
                  className="text-xs text-brand underline-offset-4 hover:underline"
                >
                  Create an integration
                </Link>
              }
            />
          ) : (
            <EmptyState message="This app is not bound to any outbound integration." />
          )
        ) : (
          <ul className="divide-y divide-border">
            {bindings.data?.map((binding) => (
              <BindingRow
                key={binding.integration.id}
                binding={binding}
                busy={unbinding === binding.integration.id}
                onUnbind={() => void onUnbind(binding)}
              />
            ))}
          </ul>
        )}

        {integrationsPhase === 'ready' && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void onBind();
            }}
          >
            <label className="flex min-w-56 flex-1 flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Integration</span>
              <select
                value={choice}
                onChange={(e) => setChoice(e.target.value)}
                disabled={available.length === 0}
                className={FIELD}
              >
                <option value="">
                  {available.length === 0
                    ? 'Every integration is already bound'
                    : 'Choose an integration'}
                </option>
                {available.map((i) => (
                  <option key={i.id} value={i.id}>
                    {operatorOwned(i) ? `${i.name} (Operator-managed)` : i.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="submit"
              size="sm"
              className="gap-1.5"
              busy={bind.isPending}
              disabled={!choice}
            >
              <Plus className="h-3.5 w-3.5" />
              Bind
            </Button>
          </form>
        )}
        {integrationsPhase !== 'ready' && integrationsPhase !== 'empty' && (
          <InlinePhase
            phase={integrationsPhase}
            error={integrations.error}
            loadingMessage="Loading your integrations…"
            onRetry={() => void integrations.refetch()}
          />
        )}
      </div>
    </Panel>
  );
}
