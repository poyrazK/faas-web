import { useMemo, useState, type FormEvent } from 'react';
import { Check, Eye, Prohibition, ShieldAlert, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { Timestamp } from '@/components/ui/timestamp';
import { Sparkline } from '@/components/dashboard/kit/chart';
import { CliCommand } from '@/components/dashboard/cli-command';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { SegmentedControl } from '@/components/dashboard/tabs';
import { Pill } from '@/components/dashboard/resource-table';
import { useCapabilityAccess, useCapabilityStage } from '@/lib/api/capabilities';
import {
  useEdgeRuleEvents,
  useEdgeRuleStats,
  type EdgeRuleEvent,
  type EdgeRuleEventOutcome,
  type EdgeRuleStatsWindow,
} from '@/lib/api/edge-rules';
import type { EdgeRule } from '@/lib/api/queries';
import { cliEdgeRuleTraceCommand } from '@/lib/cli-commands';
import { cn } from '@/lib/utils';
import { INPUT } from './fields';

/**
 * What an app's rules did: each rule's match counts with hourly totals
 * (`/edge-rules/stats`), the sampled requests behind them
 * (`/edge-rules/events`), and the CLI's trace for a request that has not
 * happened yet. The counts cover every match, a rule counted at most once a
 * request; the events are samples, the first 10 per rule a minute, kept for
 * the plan's event window (faas docs/edge-rules.md §Testing and observing).
 * Events belong to the edge-rule-history capability, which apid gates.
 */

const WINDOWS: readonly { key: EdgeRuleStatsWindow; label: string; hours: number; long: string }[] =
  [
    { key: '1h', label: '1 hour', hours: 1, long: 'hour' },
    { key: '24h', label: '24 hours', hours: 24, long: '24 hours' },
    { key: '7d', label: '7 days', hours: 168, long: '7 days' },
  ];

const OUTCOMES: Record<
  EdgeRuleEventOutcome,
  { label: string; icon: typeof Check; color?: string; hint: string }
> = {
  matched: { label: 'Matched', icon: Check, hint: 'An enforced rule matched.' },
  logged: { label: 'Logged', icon: Eye, hint: 'A log-mode rule matched and did not act.' },
  detected: {
    label: 'Detected',
    icon: ShieldAlert,
    color: 'var(--status-warning)',
    hint: 'The WAF flagged a sampled request.',
  },
  warned: {
    label: 'Warned',
    icon: WarningTriangle,
    color: 'var(--status-warning)',
    hint: 'The WAF tagged the response with X-WAF-Warning.',
  },
  blocked: {
    label: 'Blocked',
    icon: Prohibition,
    color: 'var(--status-critical)',
    hint: 'The WAF answered 403.',
  },
  challenged: {
    label: 'Challenged',
    icon: ShieldAlert,
    color: 'var(--status-warning)',
    hint: 'A browser was served the challenge page.',
  },
  rejected: {
    label: 'Rejected',
    icon: Prohibition,
    color: 'var(--status-critical)',
    hint: 'A request that is not a page load got 403.',
  },
  solved: {
    label: 'Solved',
    icon: Check,
    color: 'var(--status-good)',
    hint: 'A solved challenge earned a pass.',
  },
  failed: {
    label: 'Failed',
    icon: Prohibition,
    color: 'var(--status-critical)',
    hint: 'A challenge solution was refused.',
  },
  boxed: {
    label: 'Boxed',
    icon: Prohibition,
    color: 'var(--status-critical)',
    hint: 'The client was put in the penalty box.',
  },
};

function OutcomeBadge({ outcome }: { outcome: EdgeRuleEventOutcome }) {
  const o = OUTCOMES[outcome] ?? { label: outcome, icon: Check, hint: '' };
  const Icon = o.icon;
  return (
    <span
      title={o.hint}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs',
        !o.color && 'border-border text-muted-foreground'
      )}
      style={
        o.color
          ? { backgroundColor: `color-mix(in oklab, ${o.color} 14%, transparent)`, color: o.color }
          : undefined
      }
    >
      <Icon aria-hidden className="h-3 w-3" />
      {o.label}
    </span>
  );
}

/** A rule's name, or its kind and path when it has none. */
function ruleLabel(rule: EdgeRule | undefined, fallback?: { name?: string; kind?: string }) {
  if (rule) return rule.name || `${rule.kind} · ${rule.match_path}`;
  return fallback?.name || (fallback?.kind ? `${fallback.kind} (deleted)` : 'Deleted rule');
}

export function EdgeRuleActivity({ slug, rules }: { slug: string; rules: EdgeRule[] }) {
  const stage = useCapabilityStage('edge-rule-history');
  const [range, setRange] = useState<EdgeRuleStatsWindow>('24h');
  const [ruleFilter, setRuleFilter] = useState('');
  const [outcome, setOutcome] = useState<EdgeRuleEventOutcome | ''>('');
  const [requestId, setRequestId] = useState('');
  const byId = useMemo(() => new Map(rules.map((r) => [r.id, r])), [rules]);
  const span = WINDOWS.find((w) => w.key === range)!;

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Activity"
        help="What each rule matched, and samples of the requests behind the counts."
        actions={
          <div className="flex items-center gap-2">
            {stage && <Pill label={stage} />}
            <SegmentedControl
              label="Activity window"
              value={range}
              options={WINDOWS}
              onChange={setRange}
            />
          </div>
        }
        padded={false}
      >
        <Stats
          slug={slug}
          range={range}
          span={span}
          byId={byId}
          onEvents={(id) => setRuleFilter(id)}
        />
        <Events
          slug={slug}
          span={span}
          rules={rules}
          byId={byId}
          ruleFilter={ruleFilter}
          setRuleFilter={setRuleFilter}
          outcome={outcome}
          setOutcome={setOutcome}
          requestId={requestId}
          setRequestId={setRequestId}
        />
      </Panel>
      <Trace slug={slug} />
    </div>
  );
}

function Stats({
  slug,
  range,
  span,
  byId,
  onEvents,
}: {
  slug: string;
  range: EdgeRuleStatsWindow;
  span: (typeof WINDOWS)[number];
  byId: Map<string, EdgeRule>;
  onEvents: (ruleId: string) => void;
}) {
  const q = useEdgeRuleStats(slug, range);
  const rows = q.data?.rules ?? [];
  const phase = queryPhase({ error: q.error, loading: q.isPending, isEmpty: !rows.length });
  if (phase !== 'ready')
    return (
      <div className="p-5">
        <InlinePhase
          phase={phase}
          error={q.error}
          loadingMessage="Reading match counts…"
          emptyMessage={`No rule matched a request in the last ${span.long}.`}
          onRetry={() => void q.refetch()}
        />
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table aria-label="Matches per rule" className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="label-mono text-left text-muted-foreground">
            <th className="px-5 py-2 font-normal">Rule</th>
            <th className="px-3 py-2 text-right font-normal">Enforced</th>
            <th className="px-3 py-2 text-right font-normal">Logged</th>
            <th className="px-3 py-2 font-normal">Per hour</th>
            <th className="px-5 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border [font-variant-numeric:tabular-nums]">
          {rows.map((s) => {
            const rule = byId.get(s.rule_id);
            const label = rule
              ? ruleLabel(rule)
              : `Deleted, or not on this app (${s.rule_id.slice(0, 8)}…)`;
            return (
              <tr key={s.rule_id}>
                <td className="max-w-xs truncate px-5 py-2 text-xs">{label}</td>
                <td className="px-3 py-2 text-right">{s.matched.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {s.logged.toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  {s.series?.some((v) => v > 0) ? (
                    <Sparkline data={s.series} color="green" className="h-6 w-24" />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-5 py-2 text-right">
                  {rule && (
                    <button
                      type="button"
                      aria-label={`Events for ${label}`}
                      onClick={() => onEvents(s.rule_id)}
                      className="text-xs text-brand transition-colors hover:text-brand-hover"
                    >
                      Events
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Events({
  slug,
  span,
  rules,
  byId,
  ruleFilter,
  setRuleFilter,
  outcome,
  setOutcome,
  requestId,
  setRequestId,
}: {
  slug: string;
  span: (typeof WINDOWS)[number];
  rules: EdgeRule[];
  byId: Map<string, EdgeRule>;
  ruleFilter: string;
  setRuleFilter: (id: string) => void;
  outcome: EdgeRuleEventOutcome | '';
  setOutcome: (o: EdgeRuleEventOutcome | '') => void;
  requestId: string;
  setRequestId: (id: string) => void;
}) {
  const access = useCapabilityAccess('edge-rule-history').access;
  const on = access === 'on';
  const [typed, setTyped] = useState(requestId);
  const q = useEdgeRuleEvents(
    slug,
    {
      since: span.key,
      ...(ruleFilter ? { rule: ruleFilter } : {}),
      ...(outcome ? { outcome } : {}),
      ...(requestId ? { request_id: requestId } : {}),
    },
    on
  );
  const events: EdgeRuleEvent[] = q.data?.pages.flatMap((p) => p.events) ?? [];
  const since = q.data?.pages[0]?.since;
  // apid answers with the effective start after the plan's clamp; measured
  // from when the answer arrived, a start later than asked is the plan's limit.
  const keptHours =
    since && q.dataUpdatedAt ? (q.dataUpdatedAt - Date.parse(since)) / 3_600_000 : span.hours;
  const clamped = keptHours < span.hours - 1;
  const phase = queryPhase({
    error: q.error,
    loading: q.isPending,
    isEmpty: !events.length,
  });

  const find = (e: FormEvent) => {
    e.preventDefault();
    setRequestId(typed.trim());
  };

  return (
    <section className="flex flex-col gap-3 border-t border-border p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="label-mono text-muted-foreground">Sampled events</p>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
            The first 10 requests each rule matches a minute, newest first. WAF detections carry the
            CRS rules that scored, never the request body.
          </p>
        </div>
      </div>
      {!on ? (
        <p role="status" className="text-sm text-muted-foreground">
          {access === 'loading'
            ? 'Checking availability…'
            : 'Sampled events are not enabled for this account; the counts above still are.'}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Rule"
              value={ruleFilter}
              onChange={(e) => setRuleFilter(e.target.value)}
              className={cn(INPUT, 'w-auto max-w-full')}
            >
              <option value="">All rules</option>
              {rules.map((r) => (
                <option key={r.id} value={r.id}>
                  {ruleLabel(r)}
                </option>
              ))}
            </select>
            <select
              aria-label="Outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as EdgeRuleEventOutcome | '')}
              className={cn(INPUT, 'w-auto')}
            >
              <option value="">All outcomes</option>
              {(Object.keys(OUTCOMES) as EdgeRuleEventOutcome[]).map((o) => (
                <option key={o} value={o}>
                  {OUTCOMES[o].label}
                </option>
              ))}
            </select>
            <form onSubmit={find} className="flex min-w-0 flex-1 items-center gap-2">
              <input
                aria-label="Request ID"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder="Request ID, from a refused response"
                className={cn(INPUT, 'min-w-0 flex-1 font-mono sm:max-w-xs')}
              />
              {requestId && (
                <button
                  type="button"
                  onClick={() => {
                    setTyped('');
                    setRequestId('');
                  }}
                  className="text-xs text-brand transition-colors hover:text-brand-hover"
                >
                  Clear
                </button>
              )}
            </form>
          </div>
          {clamped && (
            <p role="status" className="text-xs text-muted-foreground">
              Your plan keeps events for {Math.max(1, Math.round(keptHours / 24))}{' '}
              {Math.round(keptHours / 24) === 1 ? 'day' : 'days'}; showing from{' '}
              <Timestamp value={since} />.
            </p>
          )}
          {phase !== 'ready' ? (
            <InlinePhase
              phase={phase}
              error={q.error}
              loadingMessage="Reading events…"
              emptyMessage={`No sampled events in the last ${span.long}${
                ruleFilter || outcome || requestId ? ' that fit the filters' : ''
              }.`}
              onRetry={() => void q.refetch()}
            />
          ) : (
            <ul aria-label="Sampled events" className="flex flex-col divide-y divide-border">
              {events.map((e) => (
                <EventRow key={e.id} event={e} rule={byId.get(e.rule_id)} />
              ))}
            </ul>
          )}
          {q.hasNextPage && (
            <div>
              <Button
                size="sm"
                variant="outline"
                disabled={q.isFetchingNextPage}
                onClick={() => void q.fetchNextPage()}
              >
                {q.isFetchingNextPage ? 'Loading…' : 'Load older events'}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EventRow({ event: e, rule }: { event: EdgeRuleEvent; rule: EdgeRule | undefined }) {
  const waf = [
    e.waf_categories?.join(', '),
    e.waf_score !== undefined ? `score ${e.waf_score}` : '',
    e.waf_rule_ids?.length ? `CRS ${e.waf_rule_ids.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const client = [e.client_ip, e.country].filter(Boolean).join(' · ');
  return (
    <li className="flex flex-col gap-1 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <OutcomeBadge outcome={e.outcome} />
        <span className="text-muted-foreground">
          <Timestamp value={e.occurred_at} />
        </span>
        <span className="min-w-0 truncate">
          {ruleLabel(rule, { name: e.rule_name, kind: e.rule_kind })}
        </span>
      </div>
      {(e.method || e.host || e.path) && (
        <span className="font-mono [overflow-wrap:anywhere]">
          {`${e.method ?? ''} ${e.host ?? ''}${e.path ?? ''}`.trim()}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
        {client && <span className="font-mono">{client}</span>}
        {e.user_agent && <span className="max-w-xs truncate">{e.user_agent}</span>}
        {e.request_id && <CopyableId value={e.request_id} label="request ID" />}
      </div>
      {waf && <span className="font-mono text-muted-foreground">{waf}</span>}
    </li>
  );
}

const TRACE_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/**
 * There is no trace endpoint: `gregale edge rule trace` simulates the gateway
 * over the rules it reads, including covering rules of the account's other
 * apps, and can compare a proposed change (docs/edge-rule-trace.md).
 */
function Trace({ slug }: { slug: string }) {
  const stage = useCapabilityStage('edge-rule-trace');
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [clientIp, setClientIp] = useState('');
  const [country, setCountry] = useState('');
  return (
    <Panel
      title="Trace a request"
      help="Which rules a request would match and what each would do, before it is sent. The CLI runs the gateway's own matching locally; the console has no trace of its own."
      actions={stage && <Pill label={stage} />}
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)]">
          <select
            aria-label="Request method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className={INPUT}
          >
            {TRACE_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            aria-label="Request URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://api.example.com/login"
            className={cn(INPUT, 'font-mono')}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            aria-label="Client IP"
            value={clientIp}
            onChange={(e) => setClientIp(e.target.value)}
            placeholder="Client IP, for ip rules (optional)"
            className={cn(INPUT, 'font-mono')}
          />
          <input
            aria-label="Country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Country code, for geo rules (optional)"
            className={cn(INPUT, 'font-mono')}
          />
        </div>
        <CliCommand
          command={cliEdgeRuleTraceCommand(slug, { url, method, clientIp, country })}
          copyLabel={`trace command for ${slug}`}
        />
      </div>
    </Panel>
  );
}
