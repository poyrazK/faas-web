import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import { CapabilityNotice } from '@/components/dashboard/capability-notice';
import { useCapability, useCapabilityAccess } from '@/lib/api/capabilities';
import {
  EDGE_RANGES,
  useAttackMode,
  useEdgeProtection,
  usePreAuthObservations,
  useSwitchAttackModeOff,
  useSwitchAttackModeOn,
  type AttackMode,
  type EdgeProtection,
  type EdgeRange,
  type PreAuthObservations,
} from '@/lib/api/edge-protection';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useAuth } from '@/lib/auth';
import { cliPreAuthCommand } from '@/lib/cli-commands';
import { CliCommand } from '@/components/dashboard/cli-command';
import { MaturityLabel } from '@/components/dashboard/maturity-label';
import { Timestamp } from '@/components/ui/timestamp';

/**
 * An app's edge protection: what the edge refused, what the pre-auth guard
 * would have refused, and the attack-mode switch.
 *
 * The counts are Prometheus increases over a range (faas
 * pkg/apid/edgerules/protection.go:42); when the metrics source fails, apid
 * answers `source: "degraded: …"` with every count zero, so a degraded answer
 * is said as such and never shown as zeros. Attack mode
 * (ADR-20261021220456) is one managed challenge rule that always ends on its
 * own after 15 minutes to 24 hours; while it is on, every client that is not
 * a browser and carries no verified credential gets 403, so both directions
 * of the switch are confirmed.
 */

const DURATIONS: { seconds: number; label: string }[] = [
  { seconds: 900, label: '15 minutes' },
  { seconds: 1800, label: '30 minutes' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 10800, label: '3 hours' },
  { seconds: 21600, label: '6 hours' },
  { seconds: 43200, label: '12 hours' },
  { seconds: 86400, label: '24 hours' },
];
const durationLabel = (seconds: number) =>
  DURATIONS.find((d) => d.seconds === seconds)?.label ?? `${Math.round(seconds / 60)} minutes`;

const DEGRADED = 'degraded:';
const degradedReason = (source: string) =>
  source.startsWith(DEGRADED) ? source.slice(DEGRADED.length).trim() || 'unknown reason' : null;

const at = (iso: string | undefined) => (iso ? Date.parse(iso) : Number.NaN);

/**
 * Whether attack mode is on now. apid's `active` was true when it answered;
 * polling stops well before a far end, so the end is checked again at render
 * and a timer re-renders the panel when it passes.
 */
function useActiveNow(status: AttackMode | undefined) {
  const ends = at(status?.expires_at);
  const [now, setNow] = useState(() => Date.now());
  const active = Boolean(status?.active) && (!Number.isFinite(ends) || ends > now);
  useEffect(() => {
    if (!active || !Number.isFinite(ends)) return;
    // setTimeout overflows past ~24.8 days; attack mode lasts at most 24 hours.
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(ends - Date.now() + 250, 2 ** 31 - 1)
    );
    return () => clearTimeout(timer);
  }, [active, ends]);
  return active;
}

/** ADR-829's default pre-auth rate, clamped to the Free plan's 5 rps. */
function defaultPreAuthRate(plan: string | undefined) {
  return { rps: plan === 'free' ? 5 : 10, burst: 20 };
}

/**
 * Edge protection routes are not in faas's reviewed organization route table
 * (pkg/apid/appaccess/routes.go), so a company app answers them only for its
 * creator while they are an owner or admin (access.go:263-269).
 */
function forbiddenInOrg(org: string) {
  return `In ${org}, an app's edge protection is open only to the person who created the app, while they are an owner or admin.`;
}

function useOrgName() {
  const workspace = useWorkspaceTarget();
  return workspace.org ? workspace.label : "the app's organization";
}

function useExplain() {
  const org = useOrgName();
  return (err: unknown) =>
    err instanceof ApiError && err.code === 'org_role_forbidden'
      ? forbiddenInOrg(org)
      : errorMessage(err);
}

/** A toast's error part: the problem itself, so its help renders, worded for a company refusal. */
function useExplainToast() {
  const org = useOrgName();
  return (err: unknown) =>
    err instanceof ApiError && err.code === 'org_role_forbidden'
      ? { error: err, description: forbiddenInOrg(org) }
      : { error: err };
}

function Region({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={label}>
      {children}
    </div>
  );
}

export function EdgeProtectionBody({ slug }: { slug: string }) {
  const [range, setRange] = useState<EdgeRange>('1h');
  const { capability } = useCapability('edge-protection');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MaturityLabel capability={capability} />
        </div>
        <label className="flex items-center gap-2">
          <span className="label-mono text-muted-foreground">Range</span>
          <Select
            value={range}
            onChange={(e) => setRange(e.target.value as EdgeRange)}
            aria-label="Range"
          >
            {EDGE_RANGES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </label>
      </div>
      <AttackModePanel slug={slug} />
      <SummaryPanel slug={slug} range={range} />
      <PreAuthPanel slug={slug} range={range} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

function AttackModePanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const explain = useExplain();
  const explainToast = useExplainToast();
  const status = useAttackMode(slug);
  const on = useSwitchAttackModeOn(slug);
  const off = useSwitchAttackModeOff(slug);
  const { capability, state, refresh } = useCapability('edge-attack-mode');
  const { access } = useCapabilityAccess('edge-attack-mode');
  // Attack mode is a managed challenge rule, so the edge_challenge flag must
  // include the account too (amendment 1); its catalog id is
  // edge-browser-challenge (faas pkg/platformflags/catalog.go:360). Only a
  // hidden flag counts: Free has no challenge rules of its own yet may use
  // attack mode, so plan-not-entitled does not.
  const challenge = useCapabilityAccess('edge-browser-challenge');
  const [seconds, setSeconds] = useState(3600);
  // apid's own answer outranks the registry: 422 edge_feature_unavailable
  // means the platform flags leave this account out (amendment 1).
  const [unreleased, setUnreleased] = useState(false);
  const phase = queryPhase({ error: status.error, loading: status.isPending });
  const current: AttackMode | undefined = status.data;
  const active = useActiveNow(current);
  const flagOff = access === 'off' || challenge.access === 'off';
  const released = access === 'on' && !flagOff && !unreleased;
  const busy = on.isPending || off.isPending;

  const switchOn = async () => {
    const extend = active;
    const span = durationLabel(seconds);
    if (
      !(await confirm({
        title: extend
          ? `Extend attack mode on ${slug} to ${span} from now?`
          : `Switch attack mode on for ${slug} for ${span}?`,
        description: extend
          ? `The end moves to ${span} from now; the start stays. Every visitor keeps being challenged until then, and it still ends on its own.`
          : `Every visitor to every host of ${slug} is challenged for ${span}. Browsers solve a short check once and continue; verified search crawlers and requests with a verified API key, consumer key or JWT pass. Every other client — scripts, uptime checks, webhooks from other services — gets 403 challenge_required. It ends on its own.`,
        confirmLabel: extend ? 'Extend' : 'Switch on',
        destructive: true,
      }))
    )
      return;
    try {
      await on.mutateAsync(seconds);
      toast({
        kind: 'success',
        title: extend ? 'Attack mode extended' : 'Attack mode on',
        description: `Ends in ${span}.`,
      });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'edge_feature_unavailable') {
        setUnreleased(true);
        toast({ kind: 'info', title: 'Attack mode is not available yet' });
        return;
      }
      toast({ kind: 'error', title: 'Could not switch attack mode on', ...explainToast(err) });
    }
  };

  const switchOff = async () => {
    if (
      !(await confirm({
        title: `Switch attack mode off for ${slug}?`,
        description:
          'Visitors are no longer challenged: scripts and other clients reach the app again, and so does any flood still under way.',
        confirmLabel: 'Switch off',
      }))
    )
      return;
    try {
      await off.mutateAsync();
      toast({ kind: 'success', title: 'Attack mode off' });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not switch attack mode off',
        ...explainToast(err),
      });
    }
  };

  return (
    <Region label="Attack mode">
      <Panel
        title="Attack mode"
        description="One switch for a flood your rules cannot keep up with: every visitor is challenged until it ends on its own."
        actions={<MaturityLabel capability={capability} />}
      >
        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={status.error && new Error(explain(status.error))}
            loadingMessage="Reading attack mode…"
            onRetry={() => void status.refetch()}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm" role="status">
              {active ? (
                <span>
                  On · ends <Timestamp value={current?.expires_at} />
                </span>
              ) : current?.expires_at ? (
                <span>
                  Off · last ended <Timestamp value={current.expires_at} />
                </span>
              ) : (
                'Off'
              )}
              {active && current?.started_at && (
                <span className="text-muted-foreground">
                  {' '}
                  · started <Timestamp value={current.started_at} />
                </span>
              )}
            </p>
            {active && (
              <p className="text-xs text-muted-foreground">
                Clients that are not browsers and carry no verified credential get 403 while it is
                on. Keep part of the app open with a challenge rule on the paths under attack
                instead.
              </p>
            )}
            {released ? (
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={seconds}
                  onChange={(e) => setSeconds(Number(e.target.value))}
                  aria-label="Attack mode duration"
                >
                  {DURATIONS.map((d) => (
                    <option key={d.seconds} value={d.seconds}>
                      {d.label}
                    </option>
                  ))}
                </Select>
                <Button
                  size="sm"
                  variant={active ? 'outline' : 'destructive'}
                  onClick={() => void switchOn()}
                  disabled={busy}
                  aria-label={active ? 'Extend attack mode' : 'Switch attack mode on'}
                >
                  {active ? 'Extend' : 'Switch on'}
                </Button>
                {active && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void switchOff()}
                    disabled={busy}
                    aria-label="Switch attack mode off"
                  >
                    Switch off
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {flagOff || unreleased ? (
                  <p className="text-sm text-muted-foreground">
                    Attack mode is not yet available to this account. Switching it off always works.
                  </p>
                ) : access !== 'loading' ? (
                  <CapabilityNotice capability={capability} state={state} onRetry={refresh} />
                ) : null}
                {active && (
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void switchOff()}
                      disabled={busy}
                      aria-label="Switch attack mode off"
                    >
                      Switch off
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Panel>
    </Region>
  );
}

/* ------------------------------------------------------------------ */

function Figure({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg [font-variant-numeric:tabular-nums]">{value.toLocaleString()}</dd>
    </div>
  );
}

function SummaryPanel({ slug, range }: { slug: string; range: EdgeRange }) {
  const explain = useExplain();
  const q = useEdgeProtection(slug, range);
  const phase = queryPhase({ error: q.error, loading: q.isPending });
  const data: EdgeProtection | undefined = q.data;
  const degraded = data ? degradedReason(data.source) : null;

  return (
    <Region label="What the edge refused">
      <Panel
        title="What the edge refused"
        description={`Requests the gateway answered before they reached ${slug}, over the last ${range}.`}
      >
        {phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={q.error && new Error(explain(q.error))}
            loadingMessage="Reading edge counts…"
            onRetry={() => void q.refetch()}
          />
        ) : degraded ? (
          <p className="text-sm text-muted-foreground" role="status">
            Counts are unavailable: {degraded}. They are not zero; the metrics could not be read.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Figure label="Pre-auth blocked" value={data.pre_auth.blocked} />
              <Figure label="Pre-auth would block" value={data.pre_auth.would_block} />
              <Figure label="Challenges issued" value={data.challenge.issued} />
              <Figure label="Challenges solved" value={data.challenge.solved} />
              <Figure label="WAF inspected" value={data.waf.inspected} />
              <Figure label="WAF detected" value={data.waf.detected} />
              <Figure label="WAF blocked" value={data.waf.blocked} />
              <Figure label="Penalty boxed" value={data.penalty.boxed} />
            </dl>
            <div className="flex flex-col gap-2">
              <p className="label-mono text-muted-foreground">Refused by gate</p>
              {data.rejections.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing refused in this range.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {data.rejections.map((r) => (
                    <li key={`${r.gate}-${r.status}`} className="flex items-center gap-3 py-1.5">
                      <span className="font-mono">{r.gate}</span>
                      <span className="font-mono text-xs text-muted-foreground">{r.status}</span>
                      <span className="ml-auto [font-variant-numeric:tabular-nums]">
                        {r.count.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {data.ai_crawlers.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="label-mono text-muted-foreground">AI crawlers</p>
                <ul className="flex flex-col divide-y divide-border text-sm">
                  {data.ai_crawlers.map((c) => (
                    <li key={c.name} className="flex flex-wrap items-center gap-3 py-1.5">
                      <span className="font-mono">{c.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {c.operator} · {c.purpose}
                      </span>
                      <span className="ml-auto [font-variant-numeric:tabular-nums]">
                        {c.count.toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Panel>
    </Region>
  );
}

/* ------------------------------------------------------------------ */

type Policy = PreAuthObservations['policies'][number];

function policyLabel(p: Policy) {
  const where = `${p.method || 'ANY'} ${p.path ?? ''}`.trim();
  if (p.kind === 'app') return 'Whole app';
  if (p.kind === 'failures') return `Failed responses · ${where}`;
  if (p.kind === 'targets') return `Targets · ${where}`;
  return where;
}

const SUGGESTION: Record<string, { title: string; color?: string }> = {
  ready: { title: 'Ready to enforce', color: 'var(--status-good)' },
  review: { title: 'Review before enforcing', color: 'var(--status-warning)' },
  insufficient_data: { title: 'Not enough data yet' },
};

function PreAuthPanel({ slug, range }: { slug: string; range: EdgeRange }) {
  const explain = useExplain();
  const { account } = useAuth();
  const q = usePreAuthObservations(slug, range);
  const phase = queryPhase({ error: q.error, loading: q.isPending });
  const data = q.data;
  const degraded = data ? degradedReason(data.source) : null;
  const suggestion = data?.suggestion;
  const advice = suggestion ? SUGGESTION[suggestion.status] : undefined;

  return (
    <Region label="Pre-auth observations">
      <Panel
        title="Pre-auth observations"
        description="The per-source limit that runs before credentials are checked. In observe mode it never rejects; it records what it would have."
      >
        {phase !== 'ready' || !data ? (
          <InlinePhase
            phase={phase}
            error={q.error && new Error(explain(q.error))}
            loadingMessage="Reading pre-auth observations…"
            onRetry={() => void q.refetch()}
          />
        ) : data.policies.length === 0 ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-muted-foreground">
              No pre-auth guard is on for this app, so nothing is observed. Turn it on in observe
              mode first; it records without rejecting:
            </p>
            <CliCommand
              command={cliPreAuthCommand(slug, 'observe', defaultPreAuthRate(account?.plan))}
              copyLabel={`pre-auth observe command for ${slug}`}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {degraded && (
              <p className="text-sm text-muted-foreground" role="status">
                Counts are unavailable: {degraded}. They are not zero; the metrics could not be
                read.
              </p>
            )}
            {suggestion && advice && (
              <div className="flex flex-col gap-1.5 rounded-md border border-border p-3 text-sm">
                <div>
                  <Pill label={advice.title} color={advice.color} />
                </div>
                <p className="text-muted-foreground">{suggestion.reason}</p>
                {suggestion.status === 'ready' && (
                  <CliCommand
                    command={cliPreAuthCommand(slug, 'enforce')}
                    copyLabel={`pre-auth enforce command for ${slug}`}
                  />
                )}
              </div>
            )}
            {!degraded && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="label-mono text-left text-muted-foreground">
                      <th className="py-1.5 pr-3 font-normal">Policy</th>
                      <th className="py-1.5 pr-3 text-right font-normal">Would block</th>
                      <th className="py-1.5 pr-3 text-right font-normal">2xx</th>
                      <th className="py-1.5 pr-3 text-right font-normal">3xx</th>
                      <th className="py-1.5 pr-3 text-right font-normal">4xx</th>
                      <th className="py-1.5 text-right font-normal">5xx</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border [font-variant-numeric:tabular-nums]">
                    {data.policies.map((p) => (
                      <tr key={p.policy_id}>
                        <td className="py-1.5 pr-3 font-mono text-xs">{policyLabel(p)}</td>
                        <td className="py-1.5 pr-3 text-right">{p.would_block}</td>
                        <td className="py-1.5 pr-3 text-right">{p.result_2xx}</td>
                        <td className="py-1.5 pr-3 text-right">{p.result_3xx}</td>
                        <td className="py-1.5 pr-3 text-right">{p.result_4xx}</td>
                        <td className="py-1.5 text-right">{p.result_5xx}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-muted-foreground">
                  A 2xx on a request it would have blocked is a possible false positive, not proof
                  the client was legitimate.
                </p>
              </div>
            )}
          </div>
        )}
      </Panel>
    </Region>
  );
}
