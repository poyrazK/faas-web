import { CheckCircle, Clock, Pause, WarningTriangle } from 'iconoir-react';
import { Timestamp } from '@/components/ui/timestamp';
import {
  budgetLevel,
  effectText,
  guaranteeText,
  reasonText,
  type BudgetPreview,
  type BudgetTarget,
} from '@/lib/budgets';
import { formatMillicents } from '@/lib/money';
import { Fact, SpendMeter, ToneLabel } from './budget-bits';

const GOOD = 'var(--status-good)';
const WARN = 'var(--status-warning)';
const MUTED = 'var(--muted-foreground)';

function Targets({ title, targets }: { title: string; targets: BudgetTarget[] }) {
  if (!targets.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <h4 className="label-mono text-muted-foreground">{title}</h4>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {targets.map((target) => (
          <li
            key={`${target.kind}-${target.id}-${target.deployment_id ?? ''}`}
            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2 text-sm"
          >
            <span className="min-w-0 font-mono break-all">
              {target.name}
              <span className="ml-2 text-xs text-muted-foreground">{target.kind}</span>
            </span>
            <span className="text-xs text-muted-foreground">{effectText(target.effect)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What a spec would do this month, from `POST /v1/billing/budgets/preview`.
 * Nothing is saved or turned on by it. The figures are this UTC month's known
 * attributed spending; partial coverage and stale evidence are said, because
 * a known subtotal below the limit does not prove the total is.
 */
export function BudgetPreviewResult({ preview }: { preview: BudgetPreview }) {
  const level = budgetLevel(preview.spec);
  const stops = preview.spec.action !== 'notify' && preview.spec.action !== 'reject_traffic';
  const stopping =
    level === 'alert'
      ? null
      : preview.enforcement_ready
        ? { label: 'Available', color: GOOD, icon: CheckCircle }
        : { label: 'Not available for this spec', color: WARN, icon: WarningTriangle };
  return (
    <section
      aria-label="Preview"
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="label-mono text-foreground">This month so far</h3>
        <span className="text-xs text-muted-foreground">
          Preview only · nothing is saved · as of <Timestamp value={preview.as_of} />
        </span>
      </div>
      <SpendMeter
        known={preview.known_millicents}
        limit={preview.spec.limit_millicents}
        label="Known spending against the limit"
      />
      {preview.known_limit_reached && (
        <ToneLabel tone={{ label: '', color: WARN, icon: WarningTriangle }}>
          Known spending is already at or over the {formatMillicents(preview.spec.limit_millicents)}{' '}
          limit.
        </ToneLabel>
      )}
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Fact label="Coverage">
          {preview.coverage_complete ? (
            <ToneLabel tone={{ label: 'Complete', color: GOOD, icon: CheckCircle }} />
          ) : (
            <ToneLabel tone={{ label: 'Partial', color: WARN, icon: WarningTriangle }}>
              Partial: the total may be higher
            </ToneLabel>
          )}
        </Fact>
        <Fact label="Saved measurements">
          {preview.fresh ? (
            <ToneLabel tone={{ label: 'Fresh', color: GOOD, icon: CheckCircle }} />
          ) : (
            <ToneLabel tone={{ label: 'Stale', color: WARN, icon: Clock }}>
              Stale: no new alert is raised from it
            </ToneLabel>
          )}
        </Fact>
        <Fact label="Automatic stop">
          {stopping ? (
            <ToneLabel tone={stopping} />
          ) : (
            <ToneLabel tone={{ label: 'None: alerts only', color: MUTED, icon: Pause }} />
          )}
        </Fact>
      </dl>
      <p className="text-sm text-muted-foreground">{guaranteeText(preview.guarantee)}</p>
      {stops ? (
        <>
          <Targets
            title={level === 'strict' ? 'Held at the limit' : 'Stopped at the limit'}
            targets={preview.targets}
          />
          {!preview.targets.length && preview.spec.enabled && (
            <p className="text-sm text-muted-foreground">
              Nothing running in this scope would be stopped now.
            </p>
          )}
        </>
      ) : null}
      <Targets title="Keeps running and spending" targets={preview.continuing_targets} />
      {preview.reasons.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
          {preview.reasons.map((reason) => (
            <li key={reason}>{reasonText(reason)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
