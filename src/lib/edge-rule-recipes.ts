import type { components } from '@/lib/api/schema';

/**
 * Edge protection recipes (faas ADR-986), the ones the suggestions endpoint
 * recommends. A recipe is not an API call of its own: faas expands it into one
 * ordinary create request on the client (`api.BuildEdgeRuleRecipe`,
 * pkg/api/edge_rule_recipes.go:205) and sends it through
 * `POST /v1/apps/{slug}/edge-rules`, which keeps validation, plan gates and
 * quotas in one place. This is that expansion, field for field, so a rule
 * applied here is the rule the CLI and apid's own page would create — down to
 * the description that lets the suggestions endpoint see it was added.
 */

type CreateEdgeRule = components['schemas']['CreateEdgeRuleRequest'];

export type RecipeId =
  | 'block-unverified-bots'
  | 'rate-limit-path'
  | 'allow-ips-only'
  | 'block-scanner-paths'
  | 'challenge-path';

export interface RecipeParam {
  name: string;
  label: string;
  help: string;
  default?: string;
  placeholder?: string;
  required?: boolean;
}

/** Blocked when a request path starts with one of these (edge_rule_recipes.go:62). */
export const SCANNER_PREFIXES = [
  '/.env',
  '/.git/',
  '/.svn/',
  '/.hg/',
  '/.aws/',
  '/.ssh/',
  '/.DS_Store',
  '/vendor/phpunit/',
  '/wp-',
  '/xmlrpc.php',
  '/phpmyadmin',
  '/pma/',
  '/cgi-bin/',
  '/server-status',
];

const PENALTY: RecipeParam = {
  name: 'penalty_minutes',
  label: 'Penalty box (minutes)',
  help: 'Optional: once the rule has refused a client, block that client from the whole app for this many minutes (1 to 1440).',
};
const PATH: RecipeParam = {
  name: 'path',
  label: 'Path',
  help: 'Path the rule covers: /** is every path, /shop/** is /shop and everything under it.',
  default: '/**',
};

export const RECIPES: Record<RecipeId, { title: string; kind: string; params: RecipeParam[] }> = {
  'block-unverified-bots': { title: 'Block unverified bots', kind: 'ip', params: [PATH] },
  'rate-limit-path': {
    title: 'Rate-limit a path per client IP',
    kind: 'throttle',
    params: [
      { name: 'path', label: 'Path', help: 'Path to limit.', default: '/login' },
      {
        name: 'methods',
        label: 'Methods',
        help: 'Comma-separated; empty means every method.',
        default: 'POST',
      },
      {
        name: 'per_minute',
        label: 'Requests per minute',
        help: 'Sustained rate per client IP.',
        default: '10',
      },
      {
        name: 'burst',
        label: 'Burst',
        help: 'Requests allowed at once before the rate applies; empty uses the per-minute value.',
        placeholder: '10',
      },
      PENALTY,
    ],
  },
  'allow-ips-only': {
    title: 'Allow only listed IPs on a path',
    kind: 'ip',
    params: [
      {
        name: 'path',
        label: 'Path',
        help: 'Path to protect: /admin/** is /admin and everything under it.',
        default: '/admin/**',
      },
      {
        name: 'cidrs',
        label: 'Allowed IPs',
        help: 'IPs or CIDR ranges, comma- or space-separated.',
        placeholder: '203.0.113.7, 198.51.100.0/24',
        required: true,
      },
    ],
  },
  'block-scanner-paths': {
    title: 'Block vulnerability scanner paths',
    kind: 'ip',
    params: [
      {
        name: 'paths',
        label: 'Path prefixes',
        help: 'Blocked when a request path starts with one of these; comma- or space-separated.',
        default: SCANNER_PREFIXES.join(', '),
      },
      PENALTY,
    ],
  },
  'challenge-path': {
    title: 'Challenge visitors on a path',
    kind: 'challenge',
    params: [
      {
        name: 'path',
        label: 'Path',
        help: 'Path to challenge: /** is the whole site, /login is one page and the form it posts to.',
        default: '/**',
      },
      {
        name: 'methods',
        label: 'Methods',
        help: 'Comma-separated; empty means every method, so a sign-in page and its form post are both covered.',
      },
    ],
  },
};

export const isRecipeId = (id: string): id is RecipeId => id in RECIPES;

// Bounds (edge_rule_recipes.go:81-84, limits.go:7620, edge_rule_match.go:24).
const MAX_PER_MINUTE = 6000;
const MAX_BURST = 1000;
const MAX_PENALTY_MINUTES = 1440;
const MAX_VALUES = 64;
const PENALTY_WITHIN_SECONDS = 60;
const PENALTY_AFTER: Partial<Record<RecipeId, number>> = {
  'block-scanner-paths': 1,
  'rate-limit-path': 3,
};
const DENY_ALL = { deny: ['0.0.0.0/0', '::/0'] };

export type RecipeResult =
  { ok: true; body: CreateEdgeRule } | { ok: false; field?: string; message: string };

const split = (s: string | undefined) => (s ?? '').split(/[,\s]+/).filter(Boolean);

function values(id: RecipeId, input: Record<string, string>) {
  const v: Record<string, string> = {};
  for (const p of RECIPES[id].params) v[p.name] = input[p.name]?.trim() || p.default || '';
  return v;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
function ipVersion(s: string): 4 | 6 | null {
  if (IPV4.test(s)) return 4;
  if (!s.includes(':') || !/^[0-9a-f:.]+$/i.test(s)) return null;
  try {
    // The URL parser is a full IPv6 grammar; anything it refuses is not one.
    new URL(`http://[${s}]/`);
    return 6;
  } catch {
    return null;
  }
}

/** A bare IP as its single-address CIDR, a CIDR as given; null when neither. */
function cidr(entry: string): string | null {
  const [ip, bits, extra] = entry.split('/');
  const version = ipVersion(ip);
  if (!version || extra !== undefined) return null;
  const max = version === 4 ? 32 : 128;
  if (bits === undefined) return `${ip}/${max}`;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= max ? entry : null;
}

const fail = (message: string, field?: string): RecipeResult => ({ ok: false, field, message });

/**
 * The create request recipe `id` expands to, or why the input is refused.
 * Rules cover every host the app serves (`@app`, as apid's page does) and
 * start in log mode unless `enforce` is set.
 */
export function buildRecipe(
  id: RecipeId,
  input: Record<string, string>,
  enforce = false
): RecipeResult {
  for (const name of Object.keys(input))
    if (!RECIPES[id].params.some((p) => p.name === name))
      return fail(`This recipe has no ${name} setting.`);
  const v = values(id, input);
  for (const p of RECIPES[id].params)
    if (p.required && !v[p.name]) return fail(`${p.label} is required.`, p.name);
  const methods = split(v.methods).map((m) => m.toUpperCase());

  let rule: Omit<CreateEdgeRule, 'match_host'>;
  switch (id) {
    case 'block-unverified-bots':
      rule = {
        match_path: v.path,
        kind: 'ip',
        action: DENY_ALL,
        match: {
          all: [
            { field: 'ua_family', op: 'eq', value: 'bot' },
            { field: 'verified_bot', op: 'missing' },
          ],
        },
      };
      break;
    case 'rate-limit-path': {
      const perMinute = Number(v.per_minute);
      if (!Number.isInteger(perMinute) || perMinute < 1 || perMinute > MAX_PER_MINUTE)
        return fail(`A whole number from 1 to ${MAX_PER_MINUTE}.`, 'per_minute');
      const burst = v.burst ? Number(v.burst) : perMinute;
      if (!Number.isInteger(burst) || burst < 1 || burst > MAX_BURST)
        return fail(`A whole number from 1 to ${MAX_BURST}.`, 'burst');
      rule = {
        match_path: v.path,
        ...(methods.length ? { match_methods: methods } : {}),
        kind: 'throttle',
        action: { requests_per_second: perMinute / 60, burst, key_by: 'ip' },
      };
      break;
    }
    case 'allow-ips-only': {
      const entries = split(v.cidrs);
      if (!entries.length) return fail('List at least one IP or CIDR.', 'cidrs');
      if (entries.length > MAX_VALUES)
        return fail(`At most ${MAX_VALUES}; use an edge rule list for more.`, 'cidrs');
      const cidrs: string[] = [];
      for (const e of entries) {
        const c = cidr(e);
        if (!c) return fail(`${e} is not an IP or CIDR.`, 'cidrs');
        cidrs.push(c);
      }
      rule = {
        match_path: v.path,
        kind: 'ip',
        action: DENY_ALL,
        match: { not: { field: 'client_ip', op: 'cidr', values: cidrs } },
      };
      break;
    }
    case 'block-scanner-paths': {
      const prefixes = split(v.paths);
      if (!prefixes.length) return fail('List at least one path prefix.', 'paths');
      if (prefixes.length > MAX_VALUES) return fail(`At most ${MAX_VALUES} prefixes.`, 'paths');
      const bad = prefixes.find((p) => !p.startsWith('/') || p.length < 2);
      if (bad) return fail(`${bad} is not a path prefix such as /.env.`, 'paths');
      rule = {
        match_path: '/**',
        kind: 'ip',
        action: DENY_ALL,
        match: { field: 'path', op: 'prefix', values: prefixes },
      };
      break;
    }
    case 'challenge-path':
      rule = {
        match_path: v.path,
        ...(methods.length ? { match_methods: methods } : {}),
        kind: 'challenge',
        action: {},
        match: { field: 'verified_bot', op: 'missing' },
      };
      break;
  }

  let penalty: CreateEdgeRule['penalty'];
  if (v.penalty_minutes) {
    const minutes = Number(v.penalty_minutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_PENALTY_MINUTES)
      return fail(`A whole number from 1 to ${MAX_PENALTY_MINUTES}.`, 'penalty_minutes');
    penalty = {
      seconds: minutes * 60,
      after: PENALTY_AFTER[id],
      within_seconds: PENALTY_WITHIN_SECONDS,
    };
  }

  return {
    ok: true,
    body: {
      match_host: '@app',
      ...rule,
      ...(penalty ? { penalty } : {}),
      name: RECIPES[id].title,
      description: `Created from the ${id} protection recipe.`,
      enabled: true,
      mode: enforce ? 'enforce' : 'log',
    },
  };
}

/**
 * What the rule will refuse, in one sentence the confirmation can show before
 * anything is created, then when it takes effect.
 */
export function recipeEffect(id: RecipeId, input: Record<string, string>, enforce: boolean) {
  const v = values(id, input);
  const methods = split(v.methods).map((m) => m.toUpperCase());
  const verbs = methods.length ? `${methods.join('/')} ` : '';
  let what: string;
  switch (id) {
    case 'block-unverified-bots':
      what = `Clients whose User-Agent says bot or crawler, unless verified, get 403 on ${v.path}.`;
      break;
    case 'rate-limit-path':
      what = `One client IP may send ${v.per_minute} ${verbs}requests a minute to ${v.path} (burst ${v.burst || v.per_minute}); the rest get 429.`;
      break;
    case 'allow-ips-only':
      what = `Every client outside ${split(v.cidrs).join(', ') || 'the listed IPs'} gets 403 on ${v.path}.`;
      break;
    case 'block-scanner-paths':
      what = `Requests for paths starting ${split(v.paths).slice(0, 3).join(', ')}${split(v.paths).length > 3 ? ' and others' : ''} get 403.`;
      break;
    case 'challenge-path':
      what = `Browsers must solve a short check before reaching ${verbs}${v.path}; scripts that cannot run JavaScript get 403.`;
      break;
  }
  const penalty = v.penalty_minutes
    ? ` A refused client is then blocked from the whole app for ${v.penalty_minutes} minutes.`
    : '';
  return `${what}${penalty} ${
    enforce
      ? 'It applies as soon as it is created.'
      : 'It starts in log mode: requests are counted, not refused, until you enforce it.'
  }`;
}
