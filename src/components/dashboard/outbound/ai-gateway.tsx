import { useState } from 'react';
import { CapabilityNotice } from '@/components/dashboard/capability-notice';
import {
  EmptyState,
  InlinePhase,
  Panel,
  StatTile,
  queryPhase,
} from '@/components/dashboard/primitives';
import { ResourceTable, type Column } from '@/components/dashboard/resource-table';
import { Select } from '@/components/ui/field';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { useCapability } from '@/lib/api/capabilities';
import {
  useOutboundAIAlerts,
  useOutboundAIRoutes,
  useOutboundAIUsage,
  type OutboundAIAlert,
  type OutboundAIUsageItem,
  type OutboundIntegration,
} from '@/lib/api/outbound';
import { formatNumber } from '@/lib/mock-data';
import { AI_PROVIDER_LABELS, formatLimit, formatMillicents } from './outbound-format';

/**
 * AI gateway reads: per-day usage by model, budget alerts, and fallback
 * routes. Shown only when the `ai-gateway` capability is available to the
 * account — every one of these endpoints answers 402/403 otherwise, and a
 * page of errors is a worse way to say "not on your plan".
 */
export function AIGatewayView({
  accountId,
  integrations,
}: {
  accountId: string;
  integrations: OutboundIntegration[] | undefined;
}) {
  const { capability, state, refresh } = useCapability('ai-gateway');
  if (state !== 'available') {
    return (
      <Panel title="AI gateway">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Token and cost usage by model, budget alerts, and fallback routes for AI integrations.
          </p>
          <CapabilityNotice capability={capability} state={state} onRetry={refresh} />
        </div>
      </Panel>
    );
  }
  return <AIGatewayContent accountId={accountId} integrations={integrations} />;
}

const todayUTC = () => new Date().toISOString().slice(0, 10);
const daysAgoUTC = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

type ModelRow = {
  id: string;
  model: string;
  callers: number;
  requests: number;
  error_requests: number;
  input_tokens: number;
  output_tokens: number;
  cost_millicents: number;
};

/** The API rolls up by caller and model; the view is by model. */
function byModel(items: OutboundAIUsageItem[]): ModelRow[] {
  const rows = new Map<string, ModelRow>();
  for (const item of items) {
    const row = rows.get(item.model) ?? {
      id: item.model,
      model: item.model,
      callers: 0,
      requests: 0,
      error_requests: 0,
      input_tokens: 0,
      output_tokens: 0,
      cost_millicents: 0,
    };
    row.callers += 1;
    row.requests += item.requests;
    row.error_requests += item.error_requests;
    row.input_tokens += item.input_tokens;
    row.output_tokens += item.output_tokens;
    row.cost_millicents += item.cost_millicents ?? 0;
    rows.set(item.model, row);
  }
  return [...rows.values()];
}

const MODEL_COLUMNS: Column<ModelRow>[] = [
  {
    key: 'model',
    label: 'Model',
    sortable: true,
    render: (r) => <span className="font-mono">{r.model}</span>,
  },
  {
    key: 'requests',
    label: 'Requests',
    numeric: true,
    sortable: true,
    render: (r) => formatNumber(r.requests),
  },
  {
    key: 'error_requests',
    label: 'Errors',
    numeric: true,
    priority: 'secondary',
    render: (r) => formatNumber(r.error_requests),
  },
  {
    key: 'input_tokens',
    label: 'Input tokens',
    numeric: true,
    sortable: true,
    render: (r) => formatNumber(r.input_tokens),
  },
  {
    key: 'output_tokens',
    label: 'Output tokens',
    numeric: true,
    sortable: true,
    render: (r) => formatNumber(r.output_tokens),
  },
  {
    key: 'cost_millicents',
    label: 'Cost',
    numeric: true,
    sortable: true,
    render: (r) => formatMillicents(r.cost_millicents),
  },
];

const BUDGET_LABELS: Record<OutboundAIAlert['budget'], string> = {
  daily_tokens: 'Daily tokens',
  app_daily_tokens: 'App daily tokens',
  daily_cost: 'Daily cost',
  monthly_cost: 'Monthly cost',
  user_daily_tokens: 'End-user daily tokens',
  user_daily_cost: 'End-user daily cost',
};

function AIGatewayContent({
  accountId,
  integrations,
}: {
  accountId: string;
  integrations: OutboundIntegration[] | undefined;
}) {
  const ai = (integrations ?? []).filter((i) => i.ai_provider);
  const [chosen, setChosen] = useState('');
  const [date, setDate] = useState('');
  const selected = ai.find((i) => i.id === chosen) ?? ai[0];
  const id = selected?.id ?? '';
  const usage = useOutboundAIUsage(accountId, id, date);
  const alerts = useOutboundAIAlerts(accountId, id);
  const routes = useOutboundAIRoutes(accountId);
  const nameOf = (integrationId: string) =>
    integrations?.find((i) => i.id === integrationId)?.name ?? 'Deleted integration';

  const u = usage.data;
  const tileState = usage.error ? 'unavailable' : usage.isPending ? 'loading' : 'ready';

  return (
    <div className="flex flex-col gap-6">
      {ai.length === 0 ? (
        <EmptyState message="No integration has an AI provider yet. Create one with an AI provider to see token usage here." />
      ) : (
        <Panel
          title="AI usage"
          description="Token and cost rollups by model for one UTC day. Rollups are kept for 90 days."
          actions={
            <div className="flex flex-wrap items-end gap-3">
              <FormField id="ai-integration" label="Integration">
                {(props) => (
                  <Select {...props} value={id} onChange={(e) => setChosen(e.target.value)}>
                    {ai.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} · {AI_PROVIDER_LABELS[i.ai_provider!]}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
              <FormField id="ai-date" label="Day (UTC)">
                {(props) => (
                  <Input
                    {...props}
                    type="date"
                    value={date || todayUTC()}
                    min={daysAgoUTC(89)}
                    max={todayUTC()}
                    onChange={(e) => setDate(e.target.value)}
                  />
                )}
              </FormField>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <StatTile
                label="Tokens"
                state={tileState}
                value={u?.daily_token_count}
                format={formatNumber}
                note={u ? `Limit: ${formatLimit(u.daily_token_limit, 'tokens')}` : undefined}
              />
              <StatTile
                label="Cost"
                state={tileState}
                value={u ? formatMillicents(u.daily_cost_millicents ?? 0) : undefined}
                note={
                  u
                    ? `Limit: ${u.daily_cost_limit_millicents == null ? 'No limit' : formatMillicents(u.daily_cost_limit_millicents)}`
                    : undefined
                }
              />
            </div>
            <ResourceTable
              rows={u ? byModel(u.items) : []}
              columns={MODEL_COLUMNS}
              initialSort={{ key: 'cost_millicents', dir: 'desc' }}
              loading={usage.isPending}
              error={usage.error}
              onRetry={() => void usage.refetch()}
              emptyMessage="No AI calls were settled on this day."
              minWidth="min-w-[640px]"
            />
          </div>
        </Panel>
      )}

      {selected && (
        <Panel
          title="Budget alerts"
          description={`Thresholds crossed at 80% and 100% on ${selected.name}, newest first. Kept for 90 days.`}
        >
          <InlinePhase
            phase={queryPhase({
              error: alerts.error,
              loading: alerts.isPending,
              isEmpty: alerts.data?.length === 0,
            })}
            error={alerts.error}
            emptyMessage="No budget threshold has been crossed."
            onRetry={() => void alerts.refetch()}
          />
          {alerts.data && alerts.data.length > 0 && (
            <ul className="divide-y divide-border">
              {alerts.data.map((alert) => (
                <li
                  key={alert.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span>
                    {BUDGET_LABELS[alert.budget]} reached {alert.threshold_percent}%
                    {alert.end_user ? ` for ${alert.end_user}` : ''}
                  </span>
                  <span className="text-xs text-muted-foreground [font-variant-numeric:tabular-nums]">
                    {alert.budget.endsWith('cost')
                      ? `${formatMillicents(alert.used)} of ${formatMillicents(alert.limit)}`
                      : `${formatNumber(alert.used)} of ${formatNumber(alert.limit)} tokens`}{' '}
                    · {alert.period_start}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel
        title="Fallback routes"
        description="Ordered AI integrations an app calls through one route; the gateway moves to the next target on a budget, availability, or provider failure."
      >
        <InlinePhase
          phase={queryPhase({
            error: routes.error,
            loading: routes.isPending,
            isEmpty: routes.data?.length === 0,
          })}
          error={routes.error}
          emptyMessage="No fallback routes."
          onRetry={() => void routes.refetch()}
        />
        {routes.data && routes.data.length > 0 && (
          <ul className="divide-y divide-border">
            {routes.data.map((route) => (
              <li key={route.id} className="py-2 text-sm">
                <p className="font-medium">
                  {route.name}{' '}
                  <span className="text-xs font-normal text-muted-foreground">
                    {route.format === 'openai' ? 'OpenAI format' : 'Native format'}
                  </span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {route.targets
                    .map((t) => `${nameOf(t.integration_id)}${t.model ? ` (${t.model})` : ''}`)
                    .join(' → ')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
