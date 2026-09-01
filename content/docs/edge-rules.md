# Edge rules

Edge rules run in front of your app, in the gateway, before an instance wakes. A rule matches a method and a path pattern and applies one behaviour — which means CORS, auth checks, rate limits and cached responses cost you no compute at all.

```
gregale edge-rules list --app <slug>
gregale edge-rules create --app <slug> …
gregale edge-rules update|get|rm …
```

In the console: the app's **Edge rules** tab, with a form per kind.

## The kinds

| Kind | What it does |
|---|---|
| Route to an app | Send matching requests to a different app. |
| Rewrite the path | Change the path before the app sees it. |
| Redirect | Answer 301/302/307/308 with a location. |
| Add or strip headers | Mutate request or response headers at the edge. |
| CORS | Answer preflights and stamp allow-origin headers without waking the app. |
| Verify a JWT | Reject requests whose token fails issuer/audience/expiry checks. |
| IP allow or deny | CIDR allow- and deny-lists. |
| Country allow or deny | The same, by geography. |
| Validate the body | Enforce a JSON schema on the request body (`validate_mode: block` rejects; warn only logs). |
| Body size limit | Cap request body bytes. |
| Rate limit | Per-route requests-per-second with a burst allowance, optionally keyed per consumer. |
| Time budget | Fail fast when the upstream would blow the latency budget. |
| Maintenance page | Serve a static answer while you work, without touching the app. |
| Response cache | Serve repeats from the edge: up to 3600 s fresh, up to 300 s stale-on-error, varying on the headers you pick. |

## Rate limits, with evidence

The throttle recommender reads your real per-route traffic and suggests a settable limit:

```
gregale throttle-suggestions <slug> --range 24h
```

Suggestions are `observed rps × headroom`, clamped to your plan's ceiling, so the number is always one the platform will accept. The console shows the same table inside the rate-limit form.

## Order and matching

Rules match on method plus path pattern; more specific patterns win. A request that fails a gate (JWT, IP, geo, body validation, rate limit, budget) is answered at the edge with an RFC 7807 problem body naming the rule code — nothing reaches the app, and nothing wakes.

## Related

- Per-app basic/bearer auth and the CORS defaults live on the app itself (**Configuration**), separate from per-route rules.
- A `cors allow` from the CLI writes a kind=CORS edge rule; `gregale cors show` reads the app-level defaults.
