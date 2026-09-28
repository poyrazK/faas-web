import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/lib/api/client';
import { ApiError } from '@/lib/api/errors';
import type { components } from '@/lib/api/schema';
import { pageHead } from '@/lib/seo';
import { DatamoshBand } from '@/components/datamosh/datamosh-band';

type Report = components['schemas']['PreflightReport'];
type Finding = components['schemas']['PreflightFinding'];
type PlanBudget = components['schemas']['PreflightPlanBudget'];
type Level = components['schemas']['PreflightLevel'];

/**
 * The public migration check.
 *
 * Outside `/dashboard` on purpose: the people this page is for have not signed
 * up and are deciding whether to. It must work with no session.
 *
 * The answer lives in the URL, so a result is a link you can send to someone.
 * That is the whole point of the page — you can check a repository you do not
 * own and open the conversation with the result rather than a pitch.
 */
export const Route = createFileRoute('/will-it-run')({
  component: WillItRun,
  validateSearch: (search: Record<string, unknown>) => ({
    source: typeof search.source === 'string' ? search.source : undefined,
    ref: typeof search.ref === 'string' ? search.ref : undefined,
  }),
  head: () =>
    pageHead({
      title: 'Will it run here?',
      description:
        'Paste a public GitHub repository and find out whether it would run on Gregale — before signing up for anything. Nothing is built or deployed.',
    }),
});

/**
 * The check answers in about a second against GitHub, and near-instantly from
 * cache or the dev mock. Without a floor the transition would flash and
 * vanish, which reads as a glitch rather than a decode — so it holds for a
 * beat. Long enough for the bulge to cross the frame once, short enough that
 * it never feels like padding.
 */
export const MIN_TRANSITION_MS = 900;

const LEVEL_COPY: Record<Level, { headline: string; tone: string; dot: string }> = {
  green: {
    headline: 'This should run as it is.',
    tone: 'text-status-good',
    dot: 'bg-status-good',
  },
  amber: {
    headline: 'This runs, with a change or two.',
    tone: 'text-status-warning',
    dot: 'bg-status-warning',
  },
  red: {
    headline: "This won't run here.",
    tone: 'text-status-serious',
    dot: 'bg-status-serious',
  },
};

function WillItRun() {
  const { source, ref } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [draft, setDraft] = useState(source ?? '');

  const query = useQuery({
    queryKey: ['preflight', source, ref],
    enabled: Boolean(source),
    retry: false,
    queryFn: () =>
      unwrap(
        api.GET('/v1/preflight', {
          params: { query: { source: source as string, ...(ref ? { ref } : {}) } },
        })
      ) as Promise<Report>,
  });

  // Keyed off the source rather than the query's own pending flag: the flag
  // clears the moment the cache answers, which would tear the timer down
  // before it ever fired.
  //
  // The state is only ever written from the timer, never synchronously inside
  // the effect — a check that has not yet reached its deadline is expressed as
  // "the settled key is not the current one", which needs no render-time
  // write to become true.
  const checkKey = source ? `${source}|${ref ?? ''}` : null;
  const [settledKey, setSettledKey] = useState<string | null>(null);
  useEffect(() => {
    if (!checkKey) return;
    const timer = setTimeout(() => setSettledKey(checkKey), MIN_TRANSITION_MS);
    return () => clearTimeout(timer);
  }, [checkKey]);

  const transitioning = Boolean(source) && (query.isFetching || settledKey !== checkKey);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed) return;
    // Navigating rather than holding the value in state is what makes the
    // result addressable: the back button and a pasted link both work.
    void navigate({ search: { source: trimmed, ref: undefined } });
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-20">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Will it run here?</h1>
        <p className="mt-3 max-w-prose text-muted-foreground">
          Paste a public GitHub repository. We read the source and tell you what would happen —
          nothing is built, deployed, or run, and you do not need an account.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="preflight-source" className="sr-only">
          Public GitHub repository
        </label>
        <input
          id="preflight-source"
          name="source"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="github.com/owner/repo"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        />
        <button
          type="submit"
          disabled={!draft.trim() || transitioning}
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity disabled:opacity-50"
        >
          {transitioning ? 'Checking…' : 'Check it'}
        </button>
      </form>

      {transitioning && <Scanning label={source ?? ''} />}
      {!transitioning && query.isError && <Failure error={query.error} />}
      {!transitioning && query.data && <Result key={query.data.commit_sha} report={query.data} />}

      {!source && (
        <p className="mt-10 max-w-prose text-sm text-muted-foreground">
          The check is deliberately cautious. It looks for a start command, a port, and the things
          that make an app impossible to run here — durable local disk, host networking, privileged
          mode. When it cannot tell, it says so rather than guessing.
        </p>
      )}
    </main>
  );
}

/**
 * The waiting state.
 *
 * A decode rather than a skeleton: there is no layout to stand in for, because
 * what arrives next depends entirely on the answer — a green verdict is two
 * lines, a red one is three findings and a table.
 *
 * It shows no stages and no percentage on purpose. The endpoint returns one
 * answer rather than streaming progress, so a step list here would be
 * animating a process the page cannot observe. The repository name is the
 * honest thing to show: it is what was asked for, and it confirms the paste
 * parsed the way the reader intended.
 */
function Scanning({ label }: { label: string }) {
  return (
    <section className="mt-10" aria-live="polite" aria-busy="true">
      <DatamoshBand />
      <p className="mt-4 font-mono text-xs text-muted-foreground">
        Reading {label || 'the repository'}…
      </p>
    </section>
  );
}

/**
 * Branches on `ApiError.code`, never the status or the prose — the sentence is
 * for humans and is allowed to change.
 */
function Failure({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : 'unknown';
  const message =
    {
      preflight_invalid_source:
        'That is not a public GitHub repository. Try github.com/owner/repo.',
      preflight_repo_not_found:
        'We could not find that repository. It may be private — this check only reads public ones.',
      preflight_source_too_large: 'That repository is larger than the check will inspect.',
      preflight_rate_limited: 'You have run a lot of checks. Give it a few minutes.',
      preflight_upstream_unavailable: 'GitHub is rate limiting us right now. Try again shortly.',
    }[code] ?? 'Something went wrong reading that repository.';

  return (
    <section className="mt-10 rounded-lg border border-status-serious/40 bg-status-serious/5 p-4">
      <p className="text-sm text-status-serious">{message}</p>
    </section>
  );
}

/**
 * Staggers one section into place. The delay is inline because it belongs to
 * the position rather than the component — `FindingList` should not know where
 * on the page it sits. The reduced-motion rule in `index.css` strips the delay
 * along with the duration, so this lands instantly rather than flickering.
 */
function Arrive({ delay, children }: { delay: number; children: ReactNode }) {
  return (
    <div className="animate-verdict-arrive" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Result({ report }: { report: Report }) {
  const level = report.verdict.level;
  const copy = LEVEL_COPY[level];
  const findings = report.verdict.findings ?? [];
  const blockers = findings.filter((finding) => finding.level === 'red');
  const changes = findings.filter((finding) => finding.level === 'amber');
  const notes = findings.filter((finding) => finding.level === 'green');

  // The verdict leads and everything else follows it in, one step apart. The
  // order is the order you read in, so the stagger reinforces the hierarchy
  // rather than decorating it.
  let step = 0;
  const next = () => step++ * 60;

  return (
    <section className="mt-10">
      <Arrive delay={next()}>
        <div className="flex items-start gap-3">
          <span className={`mt-2 size-2.5 shrink-0 rounded-full ${copy.dot}`} aria-hidden />
          <div>
            <h2 className={`text-xl font-semibold ${copy.tone}`}>{copy.headline}</h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {report.source.owner}/{report.source.repo} at {report.commit_sha.slice(0, 7)}
            </p>
          </div>
        </div>
      </Arrive>

      <Arrive delay={next()}>
        <Profile report={report} />
      </Arrive>

      {blockers.length > 0 && (
        <Arrive delay={next()}>
          <FindingList title="What stops it" findings={blockers} />
        </Arrive>
      )}
      {changes.length > 0 && (
        <Arrive delay={next()}>
          <FindingList title="What to change" findings={changes} />
        </Arrive>
      )}
      {notes.length > 0 && (
        <Arrive delay={next()}>
          <FindingList title="Worth knowing" findings={notes} />
        </Arrive>
      )}

      <Arrive delay={next()}>
        <PlanTable budgets={report.plan_budgets} />
      </Arrive>

      <p className="mt-8 max-w-prose text-xs text-muted-foreground">
        This reads your source, not a running app. It cannot see how much memory you use, what your
        dependencies do at runtime, or anything behind an environment variable. A green result means
        we found no reason it would fail — not a guarantee that it will not.
      </p>
    </section>
  );
}

function Profile({ report }: { report: Report }) {
  const profile = report.verdict.profile;
  const rows: Array<[string, string | undefined]> = [
    ['Framework', profile.framework],
    ['Start command', profile.start_command],
    ['Port', profile.port ? String(profile.port) : undefined],
    ['Health path', profile.health_path],
  ];
  const known = rows.filter((row): row is [string, string] => Boolean(row[1]));
  if (known.length === 0) return null;

  return (
    <dl className="mt-6 grid gap-x-6 gap-y-2 rounded-lg border border-border bg-card p-4 sm:grid-cols-[auto_1fr]">
      {known.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="font-mono text-sm break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function FindingList({ title, findings }: { title: string; findings: Finding[] }) {
  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
        {title}
      </h3>
      <ul className="mt-3 flex flex-col gap-3">
        {findings.map((finding) => (
          <li key={finding.code} className="rounded-lg border border-border bg-card p-4">
            <p className="font-medium">{finding.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{finding.detail}</p>
            {finding.remedy && <p className="mt-2 text-sm">{finding.remedy}</p>}
            {finding.sources && finding.sources.length > 0 && (
              <p className="mt-2 font-mono text-xs text-muted-foreground">
                {finding.sources.join(', ')}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Millicents are 1/1000 of a cent; integer-divide to cents before display. */
function formatPrice(millicents: number): string {
  const cents = Math.round(millicents / 1000);
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(
    cents / 100
  );
}

function formatRunningTime(minutes: number): string {
  const hours = Math.round(minutes / 60);
  return `${new Intl.NumberFormat().format(hours)} h`;
}

function PlanTable({ budgets }: { budgets: PlanBudget[] }) {
  if (budgets.length === 0) return null;
  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
        What it would cost
      </h3>
      <p className="mt-2 max-w-prose text-sm text-muted-foreground">
        We cannot see how much memory your app uses, so we will not guess a tier. Here is what each
        one includes. Parked apps bill nothing, so the allowance is running time, not wall-clock.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[26rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="py-2 pr-4 font-medium">Plan</th>
              <th className="py-2 pr-4 font-medium">Memory</th>
              <th className="py-2 pr-4 font-medium">Included running time</th>
              <th className="py-2 font-medium">Monthly</th>
            </tr>
          </thead>
          <tbody>
            {budgets.map((budget) => (
              <tr key={budget.plan} className="border-b border-border/60 last:border-0">
                <td className="py-2 pr-4 capitalize">{budget.plan}</td>
                <td className="py-2 pr-4 tabular-nums">{budget.ram_mb} MB</td>
                <td className="py-2 pr-4 tabular-nums">
                  {formatRunningTime(budget.included_running_minutes)}
                </td>
                <td className="py-2 tabular-nums">{formatPrice(budget.price_millicents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
