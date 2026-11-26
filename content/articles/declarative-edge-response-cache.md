**Serve repeat public `GET` and `HEAD` API responses directly from Gregale's gateway memory without waking your app or burning compute.** With `gregale edge cache`, you declare freshness windows, `stale-while-revalidate`, `stale-if-error`, and `Cache-Tag` purging in one command while Gregale enforces private-response bypass rules and cohort isolation automatically.

## Why edge caching scale-to-zero APIs is usually brittle

Read-heavy public endpoints—product catalogs, pricing feeds, public config, documentation metadata—often keep a scale-to-zero API awake all day even when the underlying data changes once an hour. Bolting an external CDN or custom edge worker in front solves the wakeups, but creates two new failure modes: forgetting to strip auth-scoped responses (leaking user data across requests) and losing cache invalidation state across deployments.

## Declare freshness and stale fallback in one command

Inside a linked project, a single rule marks a route cacheable at Gregale's gateway:

```sh
gregale edge cache GET /products/:id for 30s \
  --stale-while-revalidate 1m \
  --stale-if-error 5m \
  --vary-on Accept-Language
```

Named parameters such as `:id` map to a gateway glob (`/products/*`), or you can pass flags explicitly with `gregale edge rule create --app shop --kind cache`. With the rule above:

1. **Fresh (`30s`):** Every public cache hit returns straight from gateway memory—your microVM never wakes and compute billing is zero. (Served bytes count toward monthly egress like normal responses.)
2. **Stale-while-revalidate (`1m`):** For the next 60 seconds, Gregale serves the cached response immediately and refreshes that exact key in the background.
3. **Stale-if-error (`5m`):** If the origin fails during or after revalidation, the gateway keeps serving the last good payload for up to 300 seconds past freshness expiry.

## Built-in privacy and cache-key safety

Gregale enforces strict defaults so authenticated traffic cannot accidentally pollute public cache entries:

- **Credentialed requests always bypass:** Any request carrying an `Authorization` header (including empty or repeated headers) or any cookie skips the cache and hits your app directly.
- **Private responses are never stored:** Any response with `Set-Cookie`, `Cache-Control: no-store`, or `Cache-Control: private`, or bodies larger than `1 MiB`, is excluded from storage. A cache miss or shared-tier outage falls straight through to your app.
- **Exact key isolation:** Cache keys distinguish the app, deployment cohort, rule, HTTP method, hostname, path escaping, original query string—preserving parameter order so `?id=1&id=2` and `?id=2&id=1` never collide—plus configured `vary_on` headers (`Accept-Language` and `Accept-Encoding`).
- **Cloudflare interaction:** Cloudflare sits in front of every Gregale app. Responses without explicit `Cache-Control`, `CDN-Cache-Control`, or `Cloudflare-CDN-Cache-Control` headers stay out of Cloudflare's cache automatically, preventing accidental cross-user caching upstream.

## Tag-based purging backed by a replayable ledger

You can invalidate entries across an app, by normalized path, or across many routes at once using `Cache-Tag` headers:

```sh
gregale edge cache purge shop
gregale edge cache purge shop --path '/products/*'
gregale edge cache purge shop --tag product:42
```

When your app emits `Cache-Tag: product:42, collection-winter`, Gregale indexes up to 32 distinct ASCII tags per response (up to 128 bytes per tag and `2 KiB` total header size) as invalidation metadata and strips the `Cache-Tag` header before clients receive the response. Invalid tags cause that response to bypass caching cleanly rather than failing requests.

Purge commands write to a replayable ledger rather than fire-and-forget pub/sub, so a temporarily disconnected gateway catches up instead of serving stale entries indefinitely. You can verify propagation via `GET /v1/apps/{slug}/policy/status` (`response_cache` reports `active` once every serving gateway and optional shared Redis tier has invalidated, or `pending` while one is catching up). New deployments and rule updates also invalidate affected cache entries automatically.

## What to expect and when another option fits better

- **Optimization, not primary storage:** Cached records live strictly in memory (local gateway memory and optional shared cache), never on disk, and expire at the later configured stale boundary.
- **Large payloads, writes, or custom edge compute:** Payloads over `1 MiB`, non-`GET`/`HEAD` requests, or responses requiring arbitrary per-request JavaScript transformations at PoPs globally are better served by object storage with signed URLs or a programmable edge CDN.

See [Cache responses](/docs/cache), [Edge rules](/docs/edge-rules), [How scaling to zero works](/docs/scale-to-zero), and [Gregale pricing](/pricing) for the full command reference and header rules.
