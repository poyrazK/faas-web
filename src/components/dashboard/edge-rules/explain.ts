import type { CorsPreset, EdgeRule } from '@/lib/api/queries';
import { ruleAction } from '@/lib/api/edge-rules';
import { MATCH_FIELDS, type MatchExpr } from '@/lib/edge-rule-match';

const countries = new Intl.DisplayNames(['en'], { type: 'region' });
const words = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
const join = (values: string[]) => words.format(values);
const country = (value: string) => {
  if (value === 'TR') return 'Turkey';
  return /^[A-Z]{2}$/.test(value) ? (countries.of(value) ?? value) : value;
};
function named(values: string[], format = (value: string) => value) {
  const shown = values.slice(0, 3).map(format);
  if (values.length > 3) shown.push(`${values.length - 3} more`);
  return join(shown);
}
const size = (bytes: number) =>
  bytes >= 1048576
    ? `${Number((bytes / 1048576).toFixed(2))} MiB`
    : bytes >= 1024
      ? `${Number((bytes / 1024).toFixed(2))} KiB`
      : `${bytes} bytes`;
const duration = (seconds: number) =>
  seconds >= 60 && seconds % 60 === 0
    ? `${seconds / 60} minute${seconds === 60 ? '' : 's'}`
    : `${seconds} second${seconds === 1 ? '' : 's'}`;

/** Describe the saved condition without flattening AND/OR/NOT or exposing header values. */
export function explainCondition(match: MatchExpr, depth = 0): string {
  if (depth > 3) return 'the additional saved conditions match';
  if (match.not?.op === 'in_list')
    return explainCondition(match.not, depth + 1).replace(' is in ', ' is not in ');
  if (match.not) return `not (${explainCondition(match.not, depth + 1)})`;
  const children = match.all ?? match.any;
  if (children) {
    if (!children.length) return match.all ? 'all requests match' : 'no requests match';
    const shown = children.slice(0, 4).map((child) => explainCondition(child, depth + 1));
    if (children.length > 4)
      shown.push(
        match.all
          ? `${children.length - 4} additional saved conditions match`
          : `one of ${children.length - 4} additional saved conditions matches`
      );
    return `(${shown.join(match.all ? ' and ' : ' or ')})`;
  }
  const field = match.field ?? '';
  const [base, ...parts] = field.split(':');
  const fieldName =
    base === 'client_ip'
      ? 'client IP'
      : base === 'ua_family'
        ? 'client type'
        : (MATCH_FIELDS.find((item) => item.value === base)?.label.toLowerCase() ?? field);
  const label = parts.length ? `the ${parts.join(':')} ${fieldName}` : `the ${fieldName}`;
  if (
    ['verified_bot', 'verified_ai_crawler'].includes(base) &&
    ['exists', 'missing'].includes(match.op ?? '')
  )
    return `the caller is ${match.op === 'missing' ? 'not ' : ''}a ${fieldName}`;
  if (match.op === 'exists') return `${label} is present`;
  if (match.op === 'missing') return `${label} is absent`;
  if (match.op === 'in_list') return `${label} is in the ${match.list} list`;
  // A header/cookie/query value can contain credentials; it belongs inside the rule.
  if (['header', 'cookie', 'query'].includes(base)) return `${label} matches its saved condition`;
  const values = match.value !== undefined ? [match.value] : (match.values ?? []);
  const value = named(values, base === 'country' ? country : (value) => value);
  switch (match.op) {
    case 'eq':
      return `${label} is ${value}`;
    case 'ne':
      return `${label} is not ${value}`;
    case 'in':
      return `${label} is one of ${value}`;
    case 'not_in':
      return `${label} is none of ${value}`;
    case 'prefix':
      return `${label} starts with ${values.length > 1 ? 'one of ' : ''}${value}`;
    case 'suffix':
      return `${label} ends with ${values.length > 1 ? 'one of ' : ''}${value}`;
    case 'contains':
      return `${label} contains ${values.length > 1 ? 'one of ' : ''}${value}`;
    case 'cidr':
      return `${label} is within ${values.length > 1 ? 'one of ' : ''}${value}`;
    case 'regex':
      return `${label} matches its saved pattern`;
    default:
      return 'the saved conditions match';
  }
}

/** The request selector in ordinary language, keeping globs literal. */
function requestsFor(rule: EdgeRule, app: string, mark = (value: string) => value) {
  const methods = rule.match_methods?.length ? `${join(rule.match_methods.map(mark))} ` : '';
  const host = rule.match_host === '@app' ? app : rule.match_host;
  const path = rule.match_path && rule.match_path !== '/**' ? rule.match_path : '';
  return `${methods}requests${path ? ` for ${mark(path)}` : ''}${host && host !== '*' ? ` on ${mark(host)}` : ''}`;
}

export function ruleScope(rule: EdgeRule, app: string): string {
  const filters: string[] = [];
  if (rule.match && Object.keys(rule.match).length) filters.push(explainCondition(rule.match));
  const headers = Object.keys(rule.match_headers ?? {});
  if (headers.length)
    filters.push(
      `${named(headers)} ${headers.length === 1 ? 'matches its' : 'match their'} saved header ${headers.length === 1 ? 'value' : 'values'}`
    );
  if (rule.kind === 'route' || rule.kind === 'redirect')
    return filters.length ? `Only when ${filters.join(' and ')}.` : '';
  return `Applies to ${requestsFor(rule, app)}${filters.length ? ` when ${filters.join(' and ')}` : ''}.`;
}

/** A concrete outcome from this rule's saved values, never inferred from its name. */
export function explainRule(
  rule: EdgeRule,
  app: string,
  options: {
    wafBlocking?: boolean;
    now?: number;
    /** Values to emphasize visually; plain sentence output stays unchanged. */
    onEmphasis?: (text: string) => void;
    corsPreset?: Pick<
      CorsPreset,
      'id' | 'account_id' | 'app_id' | 'name' | 'allow_origins' | 'allow_methods'
    >;
  } = {}
): string {
  const mark = (value: string) => {
    options.onEmphasis?.(value);
    return value;
  };
  const names = (values: string[], format = (value: string) => value) =>
    named(values, (value) => mark(format(value)));
  const action = ruleAction(rule);
  const a = action && typeof action === 'object' ? (action as Record<string, unknown>) : {};
  const num = (key: string, fallback: number) => {
    const value = typeof a[key] === 'number' ? a[key] : fallback;
    mark(String(value));
    return value;
  };
  const str = (key: string, fallback = '') => mark(typeof a[key] === 'string' ? a[key] : fallback);
  const list = (key: string) =>
    Array.isArray(a[key])
      ? a[key].filter((value): value is string => typeof value === 'string')
      : [];
  let effect: string;
  let activeEffect: string | undefined;
  switch (rule.kind) {
    case 'route':
      effect = `send ${requestsFor(rule, app, mark)} to ${str('target_app_slug', 'the saved target app')}`;
      break;
    case 'rewrite':
      effect = `rewrite paths starting with ${str('from', '/')} to ${str('to', '/')}`;
      break;
    case 'redirect':
      effect = `redirect ${requestsFor(rule, app, mark)} to ${str('to', 'the saved destination')} (${num('status_code', 302)})`;
      break;
    case 'maintenance':
      effect = `return a maintenance response (503); callers can retry after ${mark(duration(num('retry_after_seconds', 60) || 60))}`;
      break;
    case 'respond':
      effect = `return ${num('status_code', 200)}${a.body === undefined ? ' with no body' : ' with the saved JSON body'}, without running ${mark(app)}`;
      break;
    case 'geo': {
      const allowed = list('allow'),
        denied = list('deny');
      effect = allowed.length
        ? `allow requests only from ${names(allowed, country)}${denied.length ? `, excluding ${names(denied, country)}` : ''}`
        : denied.length
          ? `block requests from ${names(denied, country)}`
          : 'leave requests unchanged; no countries are selected';
      break;
    }
    case 'ip': {
      const allowed = list('allow'),
        denied = list('deny');
      const all = denied.includes('0.0.0.0/0') && denied.includes('::/0');
      effect = all
        ? 'block matching requests from any IP address'
        : allowed.length
          ? `allow requests only from ${names(allowed)}${denied.length ? `, excluding ${names(denied)}` : ''}`
          : denied.length
            ? `block requests from ${names(denied)}`
            : 'leave requests unchanged; no IP addresses are selected';
      break;
    }
    case 'headers': {
      const operations = (key: string, direction: string) => {
        if (!Array.isArray(a[key])) return [];
        return a[key]
          .filter((op): op is Record<string, unknown> => typeof op === 'object' && op !== null)
          .map(
            (op) =>
              `${op.action === 'remove' ? 'remove' : 'set'} ${mark(String(op.name))} on ${direction}`
          );
      };
      const ops = [
        ...operations('request_headers', 'requests'),
        ...operations('response_headers', 'responses'),
      ];
      effect = ops.length ? join(ops) : 'leave headers unchanged; no header changes are selected';
      if (ops.length)
        activeEffect = join(
          ops.map((op) => op.replace(/^(set|remove)/, (verb) => mark(`${verb}s`)))
        );
      break;
    }
    case 'cors': {
      const preset = options.corsPreset;
      const linked = str('cors_preset_id');
      const resolved =
        preset?.id === linked &&
        preset.account_id === rule.account_id &&
        (!preset.app_id || preset.app_id === rule.app_id)
          ? preset
          : undefined;
      if (linked && !resolved) {
        effect = 'use a linked browser-access policy; open the rule to review its settings';
        break;
      }
      // The gateway fills empty fields from the preset; nonempty rule values win.
      const origins = list('allow_origins').length
        ? list('allow_origins')
        : (resolved?.allow_origins ?? []);
      const methods = list('allow_methods').length
        ? list('allow_methods')
        : (resolved?.allow_methods ?? []);
      effect = `allow browser calls from ${origins.includes('*') ? 'any website' : names(origins) || 'no other websites'}${methods.length ? ` using ${join(methods.map(mark))}` : ''}${resolved ? ` (${mark(resolved.name)})` : ''}`;
      break;
    }
    case 'jwt':
      effect = `require a signed token${str('issuer') ? ` issued by ${str('issuer')}` : ''}${list('audience').length ? ` for ${names(list('audience'))}` : ''}`;
      break;
    case 'limit':
      effect = `reject request bodies larger than ${mark(size(num('max_body_bytes', 0)))}${num('max_body_bytes_streaming', 0) ? ` (${mark(size(num('max_body_bytes_streaming', 0)))} for streamed bodies)` : ''}`;
      break;
    case 'throttle': {
      const key = str('key_by', 'none') || 'none';
      const dimension = (field: string) =>
        field === 'ip'
          ? 'IP address'
          : field === 'api_key'
            ? 'API key'
            : field === 'consumer_id'
              ? 'consumer'
              : field === 'jwt_subject'
                ? 'token subject'
                : field === 'jwt_claim'
                  ? `${str('jwt_claim_name')} token claim`
                  : field.startsWith('header:')
                    ? `${field.slice(7)} header value`
                    : field;
      const scope =
        key === 'none'
          ? 'across matching requests'
          : key === 'composite'
            ? `for each combination of ${names(list('key_fields'), dimension)}`
            : `per ${dimension(key)}`;
      effect = `limit traffic to ${num('requests_per_second', 0)} requests per second ${scope}, with bursts of ${num('burst', 0)}`;
      break;
    }
    case 'budget':
      effect = `stop waiting for a response after ${num('budget_ms', 0)} ms`;
      break;
    case 'cache':
      effect = `reuse eligible GET and HEAD responses for ${mark(duration(num('max_age_seconds', 60) || 60))}`;
      break;
    case 'validate': {
      const mode = rule.validate_mode ?? str('validate_mode', 'block');
      effect =
        mode === 'block'
          ? 'reject request bodies that fail this rule’s JSON schema'
          : `record JSON schema failures without blocking${mode === 'warn' ? ', and add a warning to the response' : ''}`;
      break;
    }
    case 'challenge':
      effect = `challenge unverified browsers; a successful check lasts ${mark(duration(num('pass_ttl_seconds', 3600) || 3600))}`;
      break;
    case 'waf': {
      const mode = str('mode', 'observe');
      effect =
        options.wafBlocking === undefined && mode !== 'observe'
          ? `check requests in ${mode} mode; enforcement availability could not be confirmed`
          : options.wafBlocking === false || mode === 'observe'
            ? `record attack matches without blocking${mode !== 'observe' ? '; enforcement is unavailable for this account' : ''}`
            : mode === 'block'
              ? `block requests with an attack score of ${num('anomaly_threshold', 5)} or higher`
              : `add a warning to responses when the attack score reaches ${num('anomaly_threshold', 5)}`;
      break;
    }
    case 'retry':
      effect = `retry transport failures on another healthy instance, up to ${num('max_attempts', 2) || 2} total attempts`;
      break;
    case 'circuit_breaker':
      effect = `stop sending traffic to an instance when ${Math.round((num('failure_threshold', 0.5) || 0.5) * 100)}% of at least ${num('min_requests', 5) || 5} requests fail within ${mark(duration(num('window_seconds', 10) || 10))}`;
      break;
    case 'async':
      effect = `accept requests with 202 and run them later${num('max_age_seconds', 0) ? `, within ${mark(duration(num('max_age_seconds', 0)))}` : ''}`;
      break;
    default:
      effect = 'apply this rule’s saved action to matching requests';
  }
  const hypothetical = () => effect.replace(/^\S+/, mark);
  if (!rule.enabled) return `Paused. Would ${hypothetical()}.`;
  if (rule.expires_at && Date.parse(rule.expires_at) <= (options.now ?? Date.now()))
    return `Expired. Would ${hypothetical()}.`;
  if (rule.mode === 'log') return `Log only. Would ${hypothetical()}.`;
  if (activeEffect)
    return `${activeEffect[0].toUpperCase()}${activeEffect.slice(1)}.`.replace(/^\S+/, mark);
  const [verb, ...rest] = effect.split(' ');
  const present =
    verb === 'apply'
      ? 'applies'
      : verb === 'retry'
        ? 'retries'
        : verb === 'watch'
          ? 'watches'
          : `${verb}s`;
  return `${mark(present[0].toUpperCase() + present.slice(1))} ${rest.join(' ')}.`;
}
