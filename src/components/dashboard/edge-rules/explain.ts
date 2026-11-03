/** Describe configured behavior, without inferring intent from a rule's name. */
export function explainRule(
  kind: string,
  action: unknown,
  enabled = true,
  logOnly = false
): string {
  const a = action && typeof action === 'object' ? (action as Record<string, unknown>) : {};
  const num = (key: string, fallback: number) => (typeof a[key] === 'number' ? a[key] : fallback);
  const str = (key: string, fallback = '') => (typeof a[key] === 'string' ? a[key] : fallback);
  const list = (key: string) =>
    Array.isArray(a[key])
      ? a[key].filter((value): value is string => typeof value === 'string')
      : [];
  let effect: string;
  switch (kind) {
    case 'maintenance':
      effect = `Return a maintenance response (HTTP 503) without sending the request to your app. Ask callers to retry after ${num('retry_after_seconds', 60) || 60} seconds.`;
      break;
    case 'route':
      effect = `Send matching requests to ${str('target_app_slug', 'the selected app')} instead of this app.`;
      break;
    case 'rewrite':
      effect = `Replace the path prefix ${str('from', '/')} with ${str('to', '/')}. The visitor keeps the same URL.`;
      break;
    case 'redirect':
      effect = `Send visitors to ${str('to', 'the configured URL')} with an HTTP ${num('status_code', 302)} redirect.`;
      break;
    case 'respond':
      effect = `Reply directly with HTTP ${num('status_code', 200)}${a.body === undefined ? ' and no body' : ' and the configured JSON body'}, without running your app.`;
      break;
    case 'headers':
      effect = 'Add, replace, or remove the configured request and response headers.';
      break;
    case 'cors':
      effect =
        'Control which websites can call this app from a browser, and which methods and headers they can use.';
      break;
    case 'jwt':
      effect = `Require a valid signed token${str('issuer') ? ` from ${str('issuer')}` : ''} before allowing the request through.`;
      break;
    case 'ip':
      effect =
        `Filter requests by source IP address. ${list('allow').length ? `Allow only the ${list('allow').length} configured addresses or networks. ` : ''}${list('deny').length ? `Block the ${list('deny').length} configured addresses or networks.` : ''}`.trim();
      break;
    case 'geo':
      effect = list('allow').length
        ? `Allow requests only from ${list('allow').join(', ')}; block other countries.`
        : `Block requests from ${list('deny').join(', ') || 'the configured countries'}.`;
      break;
    case 'validate':
      effect =
        'Check the request against the configured schema and parameter rules before it reaches your app.';
      break;
    case 'limit':
      effect = 'Reject requests whose body is larger than the configured limit.';
      break;
    case 'throttle':
      effect = `Limit matching traffic to ${num('requests_per_second', 0)} requests per second for each configured key, allowing bursts of ${num('burst', 0)}.`;
      break;
    case 'budget':
      effect = `Give matching requests a time budget of ${num('budget_ms', 0)} milliseconds.`;
      break;
    case 'cache':
      effect = `Reuse eligible GET or HEAD responses for ${num('max_age_seconds', 60) || 60} seconds. Cache exclusions and the configured stale-response limits still apply.`;
      break;
    case 'challenge':
      effect =
        'Ask browsers to complete a challenge before reaching the app. Verified crawlers and authenticated API requests can pass without it.';
      break;
    case 'waf':
      effect =
        str('mode', 'observe') === 'observe'
          ? 'Inspect requests for known attack patterns and record matches without blocking traffic.'
          : `Inspect requests for known attack patterns in ${str('mode')} mode. Enforcement depends on the protection features enabled for this account.`;
      break;
    case 'retry':
      effect = `Retry eligible failed requests, allowing up to ${num('max_attempts', 2)} total attempts within the configured retry budget.`;
      break;
    case 'circuit_breaker':
      effect = `Temporarily stop sending requests when failures reach ${Math.round(num('failure_threshold', 0.5) * 100)}% across at least ${num('min_requests', 5)} requests in ${num('window_seconds', 10)} seconds.`;
      break;
    case 'async':
      effect =
        'Accept the request with HTTP 202 and process it in the background, using the configured retry and notification settings.';
      break;
    default:
      effect =
        'Apply the configured action to matching requests. Open the rule to review its settings.';
  }
  return !enabled
    ? `Paused — this rule currently has no effect. When enabled: ${effect}`
    : logOnly
      ? `Log only — record matches without changing requests. Configured action: ${effect}`
      : effect;
}
