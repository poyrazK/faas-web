import { ApiError } from '@/lib/api/errors';
import { useDomainDoctor } from '@/lib/api/queries';
import { CapabilityGate } from './capability-gate';
import { Reveal, StatusWord } from './domain-records';
import { CHECK_ABOUT, DOMAIN_TONE, describeCheck, summarizeDoctor } from './domain-words';
import { HelpTip } from './kit/help-tip';
import { InlinePhase, queryPhase } from './primitives';
import { shortTime } from '@/lib/time';

/**
 * The five-check domain doctor (ADR-120), in the diagnostics dialog, in plain
 * words: the first thing to fix (or that nothing is wrong), then each check
 * as one sentence. `remediation` is the field that earns the panel — the exact
 * record to change — so a failing check shows it in place; the API's own
 * detail, the observed value and the check's token sit behind "Show details".
 *
 * Two states the contract makes explicit and this therefore does not flatten
 * into a generic error. `doctor_disabled` means the operator has not turned the
 * probe on — a deployment fact, not a failure of this domain, so it reads as
 * unavailable. `stale: true` means the cached observation was past its TTL and
 * the handler re-probed synchronously; saying so is more honest than showing a
 * fresh-looking timestamp.
 */

function formatWhen(value: string | undefined): string {
  if (!value) return '';
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? '' : shortTime(ms);
}

/** The doctor is a preview capability (faas catalog `domain-doctor`); off, it is not probed. */
export function DomainDoctor({ domain }: { domain: string }) {
  return (
    <CapabilityGate capability="domain-doctor" title="Domain doctor">
      <DomainDoctorReport domain={domain} />
    </CapabilityGate>
  );
}

function DomainDoctorReport({ domain }: { domain: string }) {
  const { data, isPending, error, refetch } = useDomainDoctor(domain);

  if (isPending) {
    return <p className="text-sm text-muted-foreground">Checking {domain}’s DNS and HTTPS…</p>;
  }

  // Dark-launched or mid-outage: the probe is the thing that is missing, not
  // the domain. Either way there is nothing for the customer to fix.
  if (
    error instanceof ApiError &&
    (error.code === 'doctor_disabled' || error.code === 'doctor_unavailable')
  ) {
    return (
      <p className="text-sm text-muted-foreground">
        The domain doctor is not enabled on this installation.
      </p>
    );
  }

  if (error || !data) {
    return (
      <InlinePhase
        phase={queryPhase({ error: error ?? new Error('No domain diagnosis was returned.') })}
        error={error ?? new Error('No domain diagnosis was returned.')}
        onRetry={() => void refetch()}
      />
    );
  }

  const answer = summarizeDoctor(data);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-lg leading-7 font-medium tracking-[-0.01em]">{answer.lead}</p>
        {answer.rest && <p className="text-sm text-muted-foreground">{answer.rest}</p>}
        <p className="text-xs text-muted-foreground">
          {data.stale
            ? 'Cached reading was stale, so this was re-probed just now.'
            : `Checked ${formatWhen(data.observed_at)}`}
        </p>
      </div>

      <ul aria-label="Checks" className="flex flex-col divide-y divide-border">
        {data.checks.map((check) => {
          const words = describeCheck(check);
          return (
            <li key={check.name} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex items-center gap-1 text-sm font-medium">
                  {words.label}
                  <HelpTip label={`About ${words.label}`}>
                    {CHECK_ABOUT[check.name] ?? check.detail}
                  </HelpTip>
                </span>
                <StatusWord word={words.word} tone={words.tone} title={check.status} />
              </div>

              <p className="text-sm text-muted-foreground">{words.sentence}</p>

              {check.remediation && check.status !== 'ok' && (
                <p
                  className="rounded-lg px-3 py-2 text-xs text-foreground"
                  style={{
                    background: `color-mix(in oklab, ${DOMAIN_TONE[words.tone]} 8%, transparent)`,
                  }}
                >
                  <span className="text-muted-foreground">To fix: </span>
                  <code className="select-all [overflow-wrap:anywhere]">{check.remediation}</code>
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <Reveal show="Show what each check found" hide="Hide what each check found">
        <ul aria-label="What each check found" className="flex flex-col gap-3">
          {data.checks.map((check) => (
            <li key={check.name}>
              <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Check</dt>
                <dd className="font-mono">
                  {check.name} · {check.status}
                </dd>
                <dt className="text-muted-foreground">Found</dt>
                <dd>{check.detail}</dd>
                {check.observed && (
                  <>
                    <dt className="text-muted-foreground">Observed</dt>
                    <dd>
                      <code className="select-all break-all">{check.observed}</code>
                    </dd>
                  </>
                )}
                {check.remediation && check.status === 'ok' && (
                  <>
                    <dt className="text-muted-foreground">Note</dt>
                    <dd>
                      <code className="break-all">{check.remediation}</code>
                    </dd>
                  </>
                )}
              </dl>
            </li>
          ))}
        </ul>
      </Reveal>
    </div>
  );
}
