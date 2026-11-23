import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { capSentence, egressSentence } from '@/lib/limits';
import { formatCents } from '@/lib/money';
import { InlinePhase, Panel } from '../primitives';
import { CapHistory, ForecastLine } from '../spend-control';
import { EgressChoice } from './egress-choice';
import { LimitRow } from './limit-row';
import type { BillData } from './use-bill-facts';

const GIB = 2 ** 30;
const gib = (n: number) =>
  `${n >= 10 ? Math.round(n).toLocaleString('en') : Math.round(n * 10) / 10}`;
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Hard limits on the bill: at the limit, workloads stop. Spend cap, egress
 * and object storage, each read for the active workspace only.
 */
export function YourBill({
  data,
  onEditCap,
  egressOpen,
  onEgressOpenChange,
}: {
  data: BillData;
  onEditCap: () => void;
  egressOpen?: boolean;
  onEgressOpenChange?: (open: boolean) => void;
}) {
  const { facts, sections, org } = data;
  const free = facts.plan === 'free' && !org;
  const cap = facts.cap.state === 'ready' ? facts.cap : null;
  const egress = facts.egress.state === 'ready' ? facts.egress : null;
  const storage = facts.storage.state === 'ready' ? facts.storage : null;

  return (
    <div id="your-bill" className="scroll-mt-24">
      <Panel
        title={org ? `${data.workspaceLabel}’s bill` : 'Your bill'}
        help="Hard limits. When one is reached, workloads stop."
      >
        <div className="flex flex-col">
          {/* Spend cap */}
          {sections.cap.phase !== 'ready' && !free ? (
            <LimitRow
              name="Spend cap"
              sentence={
                <InlinePhase
                  phase={sections.cap.phase}
                  error={sections.cap.error}
                  loadingMessage="Reading the spend cap…"
                  onRetry={sections.cap.retry}
                />
              }
            />
          ) : (
            <LimitRow
              name="Spend cap"
              sentence={
                org && cap?.capCents != null
                  ? `${capSentence(facts)} Gregale doesn’t report this organization’s overage here, so its use isn’t shown.`
                  : capSentence(facts)
              }
              meter={
                !org && !free && cap && cap.capCents && cap.overageCents != null
                  ? {
                      used: cap.overageCents,
                      limit: cap.capCents,
                      label: `${formatCents(cap.overageCents)} of ${formatCents(cap.capCents)}`,
                    }
                  : undefined
              }
              tone={cap?.capCents === 0 ? 'critical' : undefined}
              note={
                <>
                  {!org &&
                    (sections.usage.phase === 'error' ||
                      sections.usage.phase === 'unreachable') && (
                      <span className="flex flex-wrap items-center gap-2">
                        This month’s overage couldn’t be read.
                        <Button size="xs" variant="outline" onClick={sections.usage.retry}>
                          Try again
                        </Button>
                      </span>
                    )}
                  {data.showPostgres && !free && (
                    <span className="block">
                      Managed Postgres overage counts toward this cap, and databases stop at it.
                    </span>
                  )}
                </>
              }
              action={
                free ? undefined : (
                  <Button size="xs" variant="outline" onClick={onEditCap}>
                    {cap?.capCents == null ? 'Set a cap' : 'Change'}
                  </Button>
                )
              }
            >
              {!org && !free ? (
                <>
                  <ForecastLine />
                  <CapHistory />
                </>
              ) : undefined}
            </LimitRow>
          )}

          {/* Egress */}
          {sections.egress.phase !== 'ready' || !egress ? (
            <LimitRow
              name="Egress"
              sentence={
                <InlinePhase
                  phase={sections.egress.phase === 'ready' ? 'loading' : sections.egress.phase}
                  error={sections.egress.error}
                  loadingMessage="Reading egress…"
                  onRetry={sections.egress.retry}
                />
              }
            />
          ) : (
            <LimitRow
              name="Egress"
              sentence={egressSentence({
                enabled: egress.enabled,
                billingOff: egress.billingOff,
                electable: egress.electable,
                includedGb: egress.includedGb,
                priceMillicentsPerGib: data.egress?.price_millicents_per_gib,
                org: Boolean(org),
              })}
              meter={
                egress.usedGb != null && egress.includedGb
                  ? {
                      used: egress.usedGb,
                      limit: egress.includedGb,
                      label: `${gib(egress.usedGb)} of ${gib(egress.includedGb)} GiB`,
                    }
                  : undefined
              }
              tone={egress.enabled && !egress.billingOff ? 'good' : undefined}
              action={
                egress.electable ? (
                  <EgressChoice
                    org={org}
                    enabled={egress.enabled}
                    billingOff={egress.billingOff}
                    includedGb={egress.includedGb}
                    priceMillicentsPerGib={data.egress?.price_millicents_per_gib}
                    open={egressOpen}
                    onOpenChange={onEgressOpenChange}
                  />
                ) : (
                  <Button asChild size="xs" variant="outline">
                    <Link to="/dashboard/plans">View plans</Link>
                  </Button>
                )
              }
            />
          )}

          {/* Object storage */}
          {facts.storage.state === 'hidden' ? null : !storage ? (
            <LimitRow
              name="Object storage"
              sentence={
                <InlinePhase
                  phase={sections.storage.phase === 'ready' ? 'loading' : sections.storage.phase}
                  error={sections.storage.error}
                  loadingMessage="Reading object storage…"
                  onRetry={sections.storage.retry}
                />
              }
            />
          ) : (
            <LimitRow
              name="Object storage"
              sentence={
                storage.overCeiling
                  ? `${gib(storage.overCeiling.excessBytes / GIB)} GiB over the ceiling. Files above it will be deleted on ${day(storage.overCeiling.deletionAt)} unless you delete some first. Downloads are paused until then.`
                  : `Uploads stop at ${gib(storage.ceilingBytes / GIB)} GiB. The ceiling comes from the plan and spend cap.`
              }
              meter={{
                used: storage.usedBytes,
                limit: storage.ceilingBytes,
                label: `${gib(storage.usedBytes / GIB)} of ${gib(storage.ceilingBytes / GIB)} GiB`,
              }}
              tone={storage.overCeiling ? 'critical' : undefined}
              action={
                storage.overCeiling ? (
                  <Button asChild size="xs" variant="outline">
                    <Link to="/dashboard/storage">See buckets</Link>
                  </Button>
                ) : (
                  <span className="text-xs text-muted-foreground">Ask support to raise it</span>
                )
              }
            />
          )}
        </div>
      </Panel>
    </div>
  );
}
