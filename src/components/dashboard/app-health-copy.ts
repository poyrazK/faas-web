import type { components } from '@/lib/api/schema';

/* ------------------------------------------------------------------ *
 * The Health panel's plain-English layer (docs/console-plain-english.md):
 * one answer sentence and one value per check tile, built only from
 * fields the health read returns (faas pkg/apphealth/health.go). When
 * the API does not say why, the sentence says less — it never names a
 * cause or a timing of its own. The API's own `detail` text stays one
 * click away, in each tile's "?" tip.
 * ------------------------------------------------------------------ */

type Assessment = components['schemas']['AppHealthResponse'];
type Check = components['schemas']['AppHealthCheck'];
type CheckStatus = Check['status'];

const number = (value: number) => value.toLocaleString('en-US');

/** apid's closed set of check codes (AppHealthCheck.code), in words. */
export const CHECK_NAMES: Record<Check['code'], string> = {
  workload: 'Workload',
  deployment: 'Serving release',
  latest_deployment: 'Latest release',
  readiness: 'Readiness',
  traffic_readiness: 'Traffic readiness',
  maintenance: 'Maintenance',
  requests: 'Requests',
  collection: 'Health collection',
  queue: 'Queue',
  memory: 'Memory',
  replicas: 'App copies',
  backlog: 'Waiting work',
  dead_letters: 'Failed messages',
};

/** How much a check's status weighs, as the API ranks it when it sets `status`. */
const RANK: Record<CheckStatus, number> = {
  not_applicable: 0,
  pass: 1,
  unknown: 2,
  warning: 3,
  fail: 4,
};

/** The heaviest status among some checks; `not_applicable` when there are none. */
export function worstStatus(checks: readonly Check[]): CheckStatus {
  return checks.reduce<CheckStatus>(
    (worst, check) => (RANK[check.status] > RANK[worst] ? check.status : worst),
    'not_applicable'
  );
}

/** The checks that set the overall status, worst first, in the API's order. */
function worstChecks(data: Assessment): Check[] {
  const worst = worstStatus(data.checks);
  if (worst === 'pass' || worst === 'not_applicable') return [];
  return data.checks.filter((check) => check.status === worst);
}

const copies = (n: number) => (n === 1 ? 'copy' : 'copies');

/** What one failing or warning check means, as a clause: "none of its 2 copies are ready". */
function problem(check: Check, data: Assessment): string {
  const c = data.capacity;
  switch (check.code) {
    case 'readiness': {
      if (!c.known || check.status === 'unknown')
        return c.known && c.unknown > 0
          ? `${number(c.unknown)} of its ${copies(c.unknown)} haven't confirmed they're ready`
          : "its copies haven't confirmed they're ready";
      if (c.unready > 0)
        return c.ready === 0
          ? `none of its running copies pass their readiness check`
          : `${number(c.unready)} of its ${number(c.ready + c.unready)} running copies fail their readiness check`;
      if (c.ready < c.required) {
        const lead = c.ready === 0 ? 'none' : `only ${number(c.ready)}`;
        const starting = c.starting > 0 ? ` (${number(c.starting)} still starting)` : '';
        return `${lead} of the ${number(c.required)} ${copies(c.required)} it needs ${c.ready === 1 ? 'is' : 'are'} ready${starting}`;
      }
      if (c.starting > 0) return 'its copies are still starting';
      return "its copies aren't ready";
    }
    case 'traffic_readiness':
      return 'a live release has no copy confirmed ready';
    case 'deployment':
      if (check.status === 'unknown')
        return data.phase === 'not_deployed'
          ? 'it has no live release yet'
          : "its live release couldn't be confirmed";
      return 'no release is serving traffic';
    case 'latest_deployment': {
      if (check.status === 'unknown') return "its latest release couldn't be confirmed";
      if (check.status === 'fail')
        return 'its latest release failed and no other release is serving';
      const olderServes = data.checks.some((k) => k.code === 'deployment' && k.status === 'pass');
      return olderServes
        ? 'its latest release failed, though an older release is still serving'
        : 'its latest release failed';
    }
    case 'requests': {
      if (check.reason === 'request_plan_restricted')
        return "request counts aren't included in your plan";
      if (check.status === 'unknown') return "recent request counts couldn't be confirmed";
      const r = data.requests;
      if (r?.known && r.server_errors > 0)
        return `${number(r.server_errors)} of ${number(r.request_count)} requests failed with a server error in the last ${Math.round(r.window_seconds / 60)} minutes`;
      return 'requests are failing with server errors';
    }
    default: {
      const name = CHECK_NAMES[check.code]?.toLowerCase() ?? check.code.replace(/_/g, ' ');
      if (check.status === 'unknown') return `its ${name} check couldn't be confirmed`;
      return `its ${name} check ${check.status === 'fail' ? 'failed' : 'raised a warning'}`;
    }
  }
}

function joinClauses(parts: string[]): string {
  const unique = [...new Set(parts)];
  if (unique.length <= 1) return unique[0] ?? '';
  return `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`;
}

export interface Answer {
  /** One or two plain sentences. */
  text: string;
  /** The check whose `action` is the one useful next step, if any. */
  next?: Check;
  /** True when the next step is choosing a plan with request counts. */
  plans?: boolean;
}

/** The answer under the big status word, from a current (unexpired) assessment. */
export function answerFor(data: Assessment, name: string): Answer {
  if (data.phase === 'unsupported')
    return {
      text: `Only HTTP apps and services are checked, so ${name} isn't assessed. That doesn't mean it's down.`,
    };

  if (data.status === 'healthy') {
    const requests = data.checks.find((check) => check.code === 'requests');
    const traffic = data.requests?.known && data.requests.request_count > 0;
    const idleExpected = data.capacity.known && data.capacity.required === 0;
    const quiet = 'Nothing needs your attention.';
    switch (data.phase) {
      case 'idle':
        return {
          text: idleExpected
            ? `${name} is asleep, which is expected: no copies need to stay warm. ${quiet}`
            : `${name} is idle. ${quiet}`,
        };
      case 'stopped':
        return { text: `${name} is stopped on purpose: it's set to run no copies. ${quiet}` };
      case 'deploying':
        return { text: `${name} is healthy while a new release deploys. ${quiet}` };
      case 'serving':
        if (traffic) return { text: `${name} is serving traffic normally. ${quiet}` };
        if (requests?.reason === 'requests_unexercised')
          return {
            text: `${name} is ready and had no requests in the last ${Math.round((data.requests?.window_seconds ?? 300) / 60)} minutes. ${quiet}`,
          };
        return { text: `${name} is ready to serve. ${quiet}` };
      default:
        return { text: `${name} is healthy. ${quiet}` };
    }
  }

  const worst = worstChecks(data);
  const clauses = joinClauses(worst.slice(0, 2).map((check) => problem(check, data)));
  const next = worst.find((check) => check.action);
  const plans = worst.some((check) => check.reason === 'request_plan_restricted');

  if (data.status === 'unknown') {
    if (data.phase === 'not_deployed' && worst.every((check) => check.code === 'deployment'))
      return { text: `${name} has no live release yet, so there's nothing to check.`, next };
    return {
      text: clauses
        ? `${name}'s health can't be confirmed: ${clauses}. That doesn't mean it's down.`
        : `${name}'s health can't be confirmed right now. That doesn't mean it's down.`,
      next,
      plans,
    };
  }

  const lead = data.status === 'unhealthy' ? 'is failing' : 'needs attention';
  return {
    text: clauses ? `${name} ${lead}: ${clauses}.` : `${name} ${lead}.`,
    next,
    plans,
  };
}

export interface Tile {
  key: string;
  label: string;
  /** The heaviest status among the tile's checks, for its icon. */
  status: CheckStatus;
  value: string;
  note?: string;
  /** Every check the tile stands for; their API detail goes in its tip. */
  checks: Check[];
  /** The check whose `action` the tile links to. */
  link?: Check;
}

/** The check to link to: the heaviest one that names an action. */
function linkOf(checks: Check[]): Check | undefined {
  return [...checks]
    .filter((check) => check.action)
    .sort((a, b) => RANK[b.status] - RANK[a.status])[0];
}

const GROUPS: { key: string; codes: Check['code'][] }[] = [
  { key: 'release', codes: ['deployment', 'latest_deployment'] },
  { key: 'replicas', codes: ['readiness', 'traffic_readiness'] },
  { key: 'requests', codes: ['requests'] },
];

/** The checks as two to four tiles: release, replicas, errors, then anything else. */
export function tilesFor(data: Assessment): Tile[] {
  const tiles: Tile[] = [];
  const grouped = new Set<Check['code']>(GROUPS.flatMap((g) => g.codes));
  for (const { key, codes } of GROUPS) {
    const checks = data.checks.filter((check) => codes.includes(check.code));
    if (key === 'release' && checks.length) tiles.push(releaseTile(data, checks));
    if (key === 'replicas' && checks.length) tiles.push(replicaTile(data, checks));
    if (key === 'requests' && (checks.length || data.requests))
      tiles.push(requestTile(data, checks));
  }
  for (const check of data.checks.filter((k) => !grouped.has(k.code))) {
    tiles.push({
      key: check.code,
      label: CHECK_NAMES[check.code] ?? check.code.replace(/_/g, ' '),
      status: check.status,
      value: STATUS_WORD[check.status],
      checks: [check],
      link: linkOf([check]),
    });
  }
  return tiles;
}

const STATUS_WORD: Record<CheckStatus, string> = {
  pass: 'Passing',
  warning: 'Warning',
  fail: 'Failing',
  unknown: 'Unconfirmed',
  not_applicable: 'Not checked',
};

function releaseTile(data: Assessment, checks: Check[]): Tile {
  const serving = checks.find((check) => check.code === 'deployment');
  const latest = checks.find((check) => check.code === 'latest_deployment');
  const n = data.serving_deployment_ids.length;
  const value =
    serving?.status === 'unknown'
      ? data.phase === 'not_deployed'
        ? 'Nothing live yet'
        : 'Unconfirmed'
      : n === 0
        ? serving
          ? 'Nothing is serving'
          : 'Unconfirmed'
        : n === 1
          ? 'A release is serving'
          : `${number(n)} releases are serving`;
  const note =
    latest?.status === 'fail' || latest?.status === 'warning'
      ? 'The latest release failed'
      : latest?.status === 'not_applicable'
        ? 'A new release is deploying'
        : latest?.status === 'unknown'
          ? "The latest release couldn't be confirmed"
          : data.latest_deployment_id &&
              data.serving_deployment_ids.includes(data.latest_deployment_id)
            ? 'It is your latest release'
            : undefined;
  return {
    key: 'release',
    label: 'Live release',
    status: worstStatus(checks),
    value,
    note,
    checks,
    link: linkOf(checks),
  };
}

function replicaTile(data: Assessment, checks: Check[]): Tile {
  const c = data.capacity;
  const readiness = checks.find((check) => check.code === 'readiness');
  const traffic = checks.find((check) => check.code === 'traffic_readiness');
  const value = !c.known
    ? 'Unconfirmed'
    : c.required > 0
      ? `${number(c.ready)} of ${number(c.required)} ready`
      : c.ready > 0
        ? `${number(c.ready)} ready`
        : 'None running';
  const counts = c.known
    ? [
        c.starting > 0 && `${number(c.starting)} starting`,
        c.unready > 0 && `${number(c.unready)} not ready`,
        c.unknown > 0 && `${number(c.unknown)} unconfirmed`,
      ].filter((part): part is string => Boolean(part))
    : [];
  const note =
    traffic && traffic.status !== 'pass'
      ? 'A live release has no ready copy'
      : counts.length
        ? counts.join(' · ')
        : !c.known
          ? "Copies haven't reported in"
          : data.phase === 'stopped'
            ? 'Set to run no copies'
            : c.required === 0 && c.ready === 0
              ? 'None need to stay warm'
              : readiness?.status === 'pass' && c.ready >= c.required
                ? 'All the copies it needs are up'
                : undefined;
  return {
    key: 'replicas',
    label: 'Replicas',
    status: worstStatus(checks),
    value,
    note,
    checks,
    link: linkOf(checks),
  };
}

function requestTile(data: Assessment, checks: Check[]): Tile {
  const check = checks[0];
  const r = data.requests;
  const minutes = Math.round((r?.window_seconds ?? 300) / 60);
  let value: string;
  let note: string | undefined;
  if (check?.reason === 'request_plan_restricted') {
    value = 'Not on your plan';
    note = "Your plan doesn't include request counts";
  } else if (!r?.known) {
    value = 'Unconfirmed';
    note = "Missing counts don't mean zero errors";
  } else if (r.request_count === 0) {
    value = 'No requests';
    note = `Nothing to count in the last ${minutes} minutes`;
  } else if (r.server_errors === 0) {
    value = 'None';
    note = `0 of ${number(r.request_count)} requests failed`;
  } else {
    value = `${number(r.server_errors)} ${r.server_errors === 1 ? 'error' : 'errors'}`;
    note = `${number(r.server_errors)} of ${number(r.request_count)} requests failed (${r.error_rate_pct.toFixed(2)}%)`;
  }
  return {
    key: 'requests',
    label: `Errors · last ${minutes} min`,
    status: check?.status ?? (r?.known ? 'pass' : 'unknown'),
    value,
    note,
    checks,
    link: linkOf(checks),
  };
}
