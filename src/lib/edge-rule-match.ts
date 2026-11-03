import type { components } from '@/lib/api/schema';

/**
 * An edge rule's `match` condition (faas ADR-962, docs/edge-rules.md
 * §Conditions), as the rule dialog edits it.
 *
 * The expression is a tree of all / any / not over field-op-value leaves. The
 * form draws the shapes rules are actually written in: one join (all of, or
 * any of) over leaves, each optionally negated. That covers every recipe
 * (edge_rule_recipes.go) and the documented examples. A deeper tree cannot
 * be drawn, so `conditionsFrom` answers null and the dialog edits it as JSON
 * instead of flattening it.
 *
 * The rules are apid's (pkg/api/edge_rule_match.go:20-28 bounds, :269-382
 * leaf checks, edge_rule_list.go:228 list fit); apid stays the backstop,
 * the RE2 grammar and the closed value sets especially.
 */

export type MatchExpr = components['schemas']['EdgeRuleMatchExpr'];
export type MatchOp = NonNullable<MatchExpr['op']>;
export type ListKind = components['schemas']['EdgeRuleListResponse']['kind'];

const MAX_NODES = 32;
const MAX_VALUES = 64;
const MAX_VALUE_BYTES = 256;

/** The field selector as picked; header, cookie and query carry a name. */
export const MATCH_FIELDS = [
  { value: 'path', label: 'Path' },
  { value: 'method', label: 'Method' },
  { value: 'host', label: 'Host' },
  { value: 'client_ip', label: 'Client IP' },
  { value: 'country', label: 'Country' },
  { value: 'asn', label: 'ASN' },
  { value: 'header', label: 'Header' },
  { value: 'cookie', label: 'Cookie' },
  { value: 'query', label: 'Query parameter' },
  { value: 'ua_family', label: 'User-Agent family' },
  { value: 'verified_bot', label: 'Verified crawler' },
  { value: 'ai_crawler', label: 'AI crawler' },
  { value: 'ai_crawler_purpose', label: 'AI crawler purpose' },
  { value: 'verified_ai_crawler', label: 'Verified AI crawler' },
] as const;
export type MatchField = (typeof MATCH_FIELDS)[number]['value'];

export const NAMED_FIELDS = new Set<string>(['header', 'cookie', 'query']);
/** Gated by the edge_ai_crawlers flag (edge-ai-crawler-controls); absent while it is off. */
export const AI_CRAWLER_FIELDS = new Set<string>([
  'ai_crawler',
  'ai_crawler_purpose',
  'verified_ai_crawler',
]);
const CLOSED_FIELDS = new Set<string>(['ua_family', 'verified_bot', ...AI_CRAWLER_FIELDS]);

/** The closed value sets apid checks (edge_rule_match.go:648), for hints. */
export const CLOSED_VALUES: Record<string, string> = {
  ua_family: 'browser, mobile, bot, tool, other',
  verified_bot: 'googlebot, bingbot, applebot, yandexbot, baiduspider, yahoo, petalbot',
  ai_crawler: 'such as gptbot, claudebot, ccbot, perplexitybot, bytespider',
  ai_crawler_purpose: 'training, search, assistant',
  verified_ai_crawler:
    'gptbot, oai-searchbot, chatgpt-user, perplexitybot, perplexity-user and others that publish IP ranges',
};

export const OP_LABEL: Record<MatchOp, string> = {
  eq: 'is',
  ne: 'is not',
  in: 'is one of',
  not_in: 'is none of',
  prefix: 'starts with',
  suffix: 'ends with',
  contains: 'contains',
  exists: 'is present',
  missing: 'is absent',
  regex: 'matches regex',
  cidr: 'is in CIDR',
  in_list: 'is in list',
};

const base = (field: string) => field.split(':')[0];

/** Which account list kind can serve a field (edge_rule_list.go:228). */
export function listKindFor(field: string): ListKind | null {
  switch (base(field)) {
    case 'client_ip':
      return 'ip';
    case 'country':
      return 'country';
    case 'host':
      return 'host';
    case 'asn':
      return 'asn';
    case 'path':
    case 'header':
    case 'cookie':
    case 'query':
      return 'string';
  }
  return null;
}

/** The operators apid accepts on a field (edge_rule_match.go:300-372, :669). */
export function opsFor(field: string): MatchOp[] {
  const f = base(field);
  if (CLOSED_FIELDS.has(f)) return ['eq', 'ne', 'in', 'not_in', 'exists', 'missing'];
  if (f === 'asn') return ['eq', 'ne', 'in', 'not_in', 'exists', 'missing', 'in_list'];
  if (f === 'client_ip')
    return ['cidr', 'eq', 'ne', 'in', 'not_in', 'exists', 'missing', 'in_list'];
  const ops: MatchOp[] = [
    'eq',
    'ne',
    'in',
    'not_in',
    'prefix',
    'suffix',
    'contains',
    'regex',
    'exists',
    'missing',
  ];
  return listKindFor(f) ? [...ops, 'in_list'] : ops;
}

/** How many values an operator takes. */
export function valueShape(op: MatchOp): 'none' | 'one' | 'many' | 'list' {
  if (op === 'exists' || op === 'missing') return 'none';
  if (op === 'eq' || op === 'ne' || op === 'regex') return 'one';
  if (op === 'in_list') return 'list';
  return 'many';
}

export interface Condition {
  negate: boolean;
  field: MatchField;
  /** The header, cookie or query parameter name. */
  name: string;
  op: MatchOp;
  values: string[];
  list: string;
}

export interface Conditions {
  join: 'all' | 'any';
  items: Condition[];
}

export function emptyCondition(): Condition {
  return { negate: false, field: 'path', name: '', op: 'prefix', values: [], list: '' };
}

function leafFrom(e: MatchExpr): Condition | null {
  const keys = Object.keys(e);
  if (!e.field || !e.op || e.all || e.any || e.not) return null;
  if (keys.some((k) => !['field', 'op', 'value', 'values', 'list'].includes(k))) return null;
  const [head, ...rest] = e.field.split(':');
  const name = rest.join(':');
  if (!MATCH_FIELDS.some((f) => f.value === head)) return null;
  if (NAMED_FIELDS.has(head) !== Boolean(name)) return null;
  return {
    negate: false,
    field: head as MatchField,
    name,
    op: e.op,
    values: e.value ? [e.value] : (e.values ?? []),
    list: e.list ?? '',
  };
}

function itemFrom(e: MatchExpr): Condition | null {
  if (e.not && Object.keys(e).length === 1) {
    const leaf = leafFrom(e.not);
    return leaf && { ...leaf, negate: true };
  }
  return leafFrom(e);
}

/** The form's view of a stored condition, or null when only JSON can show it. */
export function conditionsFrom(match: MatchExpr | null | undefined): Conditions | null {
  if (!match || Object.keys(match).length === 0) return { join: 'all', items: [] };
  for (const join of ['all', 'any'] as const) {
    const group = match[join];
    if (group && Object.keys(match).length === 1) {
      const items = group.map(itemFrom);
      return items.every(Boolean) ? { join, items: items as Condition[] } : null;
    }
  }
  const one = itemFrom(match);
  return one ? { join: 'all', items: [one] } : null;
}

function leafExpr(c: Condition): MatchExpr {
  const field = NAMED_FIELDS.has(c.field) ? `${c.field}:${c.name.trim()}` : c.field;
  const shape = valueShape(c.op);
  const values = c.values.map((v) => v.trim()).filter(Boolean);
  const leaf: MatchExpr =
    shape === 'none'
      ? { field, op: c.op }
      : shape === 'list'
        ? { field, op: c.op, list: c.list }
        : shape === 'one'
          ? { field, op: c.op, value: values[0] ?? '' }
          : { field, op: c.op, values };
  return c.negate ? { not: leaf } : leaf;
}

/** The `match` to send; undefined when there are no conditions. */
export function conditionsToMatch(c: Conditions): MatchExpr | undefined {
  if (!c.items.length) return undefined;
  if (c.items.length === 1) return leafExpr(c.items[0]);
  return { [c.join]: c.items.map(leafExpr) };
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

function cidrOk(v: string) {
  const [ip, bits, extra] = v.split('/');
  if (extra !== undefined || bits === undefined || !/^\d{1,3}$/.test(bits)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip))
    return ip.split('.').every((o) => Number(o) <= 255) && Number(bits) <= 32;
  if (!ip.includes(':') || !/^[0-9a-f:.]+$/i.test(ip)) return false;
  try {
    new URL(`http://[${ip}]/`);
    return Number(bits) <= 128;
  } catch {
    return false;
  }
}

/**
 * Errors keyed `match.<index>` (and `match` for the whole tree). Regexes are
 * checked with JavaScript's engine, which accepts a little more than RE2;
 * apid answers the rest.
 */
export function validateConditions(c: Conditions): Record<string, string> {
  const errors: Record<string, string> = {};
  const nodes = (c.items.length > 1 ? 1 : 0) + c.items.reduce((n, i) => n + (i.negate ? 2 : 1), 0);
  if (nodes > MAX_NODES)
    errors.match = `Too many conditions: at most 31, and a negated one counts twice (${MAX_NODES} parts in all).`;
  c.items.forEach((item, i) => {
    const at = `match.${i}`;
    const shape = valueShape(item.op);
    const values = item.values.map((v) => v.trim()).filter(Boolean);
    if (NAMED_FIELDS.has(item.field) && !item.name.trim())
      errors[at] = `Name the ${item.field === 'query' ? 'query parameter' : item.field}.`;
    else if (!opsFor(item.field).includes(item.op))
      errors[at] = `${item.field} cannot use “${OP_LABEL[item.op]}”.`;
    else if (shape === 'one' && values.length !== 1) errors[at] = 'Give one value.';
    else if (shape === 'many' && !values.length) errors[at] = 'Give at least one value.';
    else if (shape === 'list' && !item.list) errors[at] = 'Pick a list.';
    else if (values.length > MAX_VALUES) errors[at] = `At most ${MAX_VALUES} values; use a list.`;
    else if (values.some((v) => bytes(v) > MAX_VALUE_BYTES))
      errors[at] = `Values are at most ${MAX_VALUE_BYTES} bytes.`;
    else if (item.op === 'regex') {
      try {
        new RegExp(values[0]);
      } catch {
        errors[at] = 'Not a valid regular expression.';
      }
    } else if (item.op === 'cidr') {
      const bad = values.find((v) => !cidrOk(v));
      if (bad) errors[at] = `${bad} is not a CIDR such as 10.0.0.0/8.`;
    }
  });
  return errors;
}

function leafText(e: MatchExpr): string {
  if (e.not) return `not ${leafText(e.not)}`;
  const value = e.list ? e.list : e.value ? e.value : (e.values ?? []).join(', ');
  return [e.field, e.op, value].filter(Boolean).join(' ');
}

/** A short description for the rules table. */
export function summariseMatch(match: MatchExpr | null | undefined): string {
  if (!match || Object.keys(match).length === 0) return '';
  const group = match.all ?? match.any;
  if (group)
    return `${group.length} condition${group.length === 1 ? '' : 's'} (${match.all ? 'all' : 'any'})`;
  return leafText(match);
}
