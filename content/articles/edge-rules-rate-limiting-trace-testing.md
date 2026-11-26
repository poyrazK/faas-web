**Enforce rate limits, JWT checks, IP/country blocks, CORS, JSON Schema validation, and request rewrites at the gateway—and test rules deterministically with replayable JSON scenarios before breaking live traffic.** Refused requests never wake your microVM or consume compute.

## Why gateway rules fail in typical PaaS stacks

On most platforms, adding request throttling, path validation, or IP allowlists forces you either to stitch together an external Cloudflare/Nginx proxy in front of your PaaS or write middleware in application code—meaning abusive scrapers, malformed uploads, and preflight `OPTIONS` requests still wake cold containers and burn billable RAM before being rejected. And editing regex or firewall rules directly in production risks locking out real users.

## Programmable edge rules that protect idle apps

Gregale evaluates edge rules at the gateway before waking your app, in a strict cheapest-first pipeline (`route`, `maintenance`, `redirect`, `rewrite`, `headers`, `cors`, `ip`, `geo`, `jwt`, `limit`, `throttle`, `waf`, `validate`, `challenge`, `cache`, `async`, and `budget`):

```sh
# Rate-limit searches across all app hosts without waking VMs on 429s
gregale edge rule create --app my-api --kind throttle \
  --match-host @app --match-path '/search/**' \
  --throttle-requests-per-second 5 --throttle-burst 10

# Share reusable office IP lists across apps and apply temporary 2h scraper blocks
gregale edge rule-list create office-ips --kind ip --item 203.0.113.0/24 --item 2001:db8::1
gregale edge rule create --app my-api --kind ip --match-host @app --match-path '/**' \
  --ip-deny 192.0.2.0/24 --expires-in 2h --name "block scraper"
```

- **Bypass-resistant normalization:** Security gates (`ip`, `geo`, `jwt`, `limit`, `throttle`, `validate`, `waf`, `challenge`) normalize `.` / `..` traversal segments, double slashes, case, `;` path parameters, and `X-HTTP-Method-Override` headers before matching.
- **Draft 2020-12 JSON validation:** `validate` rules enforce JSON schemas and unique case-insensitive object property keys (`422 request_validation_failed`) before bytes reach Go or ASP.NET handlers.
- **Safe rollout and instant rollback:** Deploy risky rules in `mode: log` (`gregale edge rule review`), guard concurrent updates with `If-Match` ETags, and revert any mistake with `gregale edge rule rollback --app my-api --to 12`.

| Rule limit per app | Free | Hobby | Pro | Scale |
| ------------------ | ---: | ----: | --: | ----: |
| Total edge rules   |    5 |    25 | 100 |   500 |
| `geo` rules        |    1 |     5 |  25 |   100 |
| `throttle` rules   |    1 |     5 |  25 |   100 |
| `cache` rules      |    0 |     1 |   5 |    20 |

## Replayable edge-rule trace testing

Instead of guessing how overlapping rules interact, replay exact requests locally against live app or project-environment rules via versioned scenario files:

```sh
gregale edge rule trace --config trace.json
```

Trace scenarios (`version: 1`, up to `2 MiB` config and `1 MiB` `body` or `body_base64`) support repeated headers, simulated `client_ip` / `country`, and `--project` / `--environment` scopes without sending customer payloads to external logs or mutating production state. Whenever an outcome depends on live runtime state—such as a token bucket counter, cached response, or live JWKS fetch—the trace explicitly stops as `incomplete` instead of guessing.

## Tradeoffs and boundaries

Edge rules apply to public hosts and automatically inherit `@app` security rules onto PR previews, whereas internal service-to-service traffic (`*.internal`), scheduled crons, queues, and direct invocations skip public edge rules (so internal auth remains your app's responsibility). Features such as `jwt`, `ip`, `cache`, and `challenge` require Hobby or higher, `waf` requires Pro+, and `retry`/`circuit_breaker`/`async` rules are gated per account.

See [Edge rules](/docs/edge-rules), [Reusable edge-rule trace scenarios](/docs/edge-rule-trace), [Security](/docs/security), [Cache public API responses at the edge without waking your app](/articles/declarative-edge-response-cache), and [Gregale pricing](/pricing).
