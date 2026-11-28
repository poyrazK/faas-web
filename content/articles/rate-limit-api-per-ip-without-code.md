**On Gregale, one edge rule rate-limits your API per client IP without any code:
`gregale edge rule create --app my-api --kind throttle --match-host @app
--match-path '/api/**' --throttle-key-by ip --throttle-requests-per-second 5
--throttle-burst 20`.** A caller over the limit gets `429` from Gregale's edge,
before the request reaches your app, so abusive traffic never wakes it or adds
running time. Edge rules are in beta on every plan, Free included.

## Limit each IP

```bash
gregale edge rule create --app my-api --kind throttle \
  --match-host @app --match-path '/api/**' \
  --throttle-key-by ip --throttle-requests-per-second 5 --throttle-burst 20
```

Each client IP gets a token bucket that refills at 5 requests a second and
holds 20, so a client can burst to 20 requests and then keeps a steady 5 a
second. IPv6 clients are grouped by /64, so one machine can't dodge the limit
by rotating addresses inside its block.

- **`--match-host @app`** covers every host the app serves, custom domains
  included.
- **`--match-path '/api/**'`** covers `/api` and everything beneath it; use
  `'/**'` for every path.
- **The limit holds for the whole app:** buckets are counted across every
  gateway that serves it, not per server.

## What a limited caller sees

A request that finds its bucket empty gets `429` with the code
`rate_limited`. Responses on the route carry `X-RouteRateLimit-Limit`,
`X-RouteRateLimit-Remaining`, `X-RouteRateLimit-Reset` and
`X-RouteRateLimit-Policy`, so a well-behaved client can slow down before it
hits the limit.

## Try it before you enforce it

Start the rule in log mode: it counts what it would limit and refuses nothing.

```bash
gregale edge rule create --app my-api --kind throttle --mode log \
  --match-host @app --match-path '/api/**' \
  --throttle-key-by ip --throttle-requests-per-second 5 --throttle-burst 20

gregale edge rule events --app my-api --outcome logged   # who would have been limited
gregale edge rule review --app my-api                    # log-mode rules that look ready
```

When the logged requests look like abuse and not your own users, switch the
rule to `enforce`.

[gregale-dev/edge-waf-rate-limit-starter](https://github.com/gregale-dev/edge-waf-rate-limit-starter)
is a sample API with rate-limit, WAF, bot-challenge and cache rules, and trace
scenarios to test them before you enforce them.

## Limit by something other than IP

| `--throttle-key-by` | One bucket per                                   |
| ------------------- | ------------------------------------------------ |
| `ip`                | client IP (IPv6 by /64)                          |
| `api_key`           | API key                                          |
| `consumer_id`       | API consumer, across its rotated keys            |
| `jwt_subject`       | JWT `sub`                                        |
| `country`           | client country                                   |
| `composite`         | up to 4 fields, such as `ip` and `header:<name>` |
| `none`              | the whole route (every caller shares one bucket) |

To slow down password guessing without limiting people who sign in
correctly, count only failed sign-ins:

```json
{
  "kind": "throttle",
  "match_host": "@app",
  "match_path": "/login",
  "action": {
    "requests_per_second": 0.1,
    "burst": 5,
    "key_by": "composite",
    "key_fields": ["ip", "header:x-username"],
    "count_statuses": [401]
  }
}
```

With `count_statuses: [401]`, only responses with status 401 use a token:
five wrong passwords for one username from one IP, then one try every 10
seconds.

## How other platforms compare

| Platform             | Per-IP rate limiting without code                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Gregale**          | A `throttle` edge rule per IP, API key, JWT subject or a mix; limited requests never reach the app                                  |
| **Vercel**           | WAF rate limiting on all plans: 1 rule on Hobby and 40 on Pro, fixed window; token bucket on Enterprise; usage-based on Pro         |
| **Google Cloud Run** | Cloud Armor rate limiting, which runs on an external Application Load Balancer; restrict ingress so the default URL can't bypass it |
| **Render**           | Network-level DDoS protection; Render says application-level rate limiting is the defense to add yourself                           |
| **Railway**          | No built-in rate limiting; Railway staff point to the `X-Real-IP` header for limiting in your app                                   |
| **Fly.io**           | Fly staff say Fly.io doesn't have rate limiting built in                                                                            |

Checked against each vendor's public documentation and forum answers on
November 27, 2026:
[Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting),
[Cloud Armor rate limiting](https://docs.cloud.google.com/armor/docs/rate-limiting-overview),
[How Render handles DDoS attacks](https://render.com/articles/how-render-handles-ddos-attacks),
[Railway: IPs and rate limiting](https://station.railway.com/questions/ips-and-rate-limiting-bab48b5c),
[Fly.io community: blocking IPs that send too many requests](https://community.fly.io/t/is-it-possible-to-block-ips-if-they-send-to-many-requests/11576).

## Pricing

Rate limiting costs nothing extra, and refused requests add no running time.
Each plan caps how many throttle rules an app can have and how loose a rule
can be; a throttle rule can only tighten the plan's limit:

| Plan  | Monthly | Throttle rules per app | Max rate (requests/s) | Max burst | Buckets per rule |
| ----- | ------: | ---------------------: | --------------------: | --------: | ---------------: |
| Free  |      $0 |                      1 |                     5 |        20 |              100 |
| Hobby |     $10 |                      5 |                    20 |       100 |            1,000 |
| Pro   |     $30 |                     25 |                   100 |       500 |            5,000 |
| Scale |     $99 |                    100 |                   500 |     2,000 |           10,000 |

See [Edge rules](/docs/edge-rules#throttle) and [Gregale pricing](/pricing).
