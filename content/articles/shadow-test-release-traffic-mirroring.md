**To test a new release on real production traffic without any user seeing
its answers, mirror the traffic.** Mirroring copies a share of live requests to
the new version, compares its responses with the ones the serving version
gave, and throws the copies' responses away. On Gregale you stage the new
version with `gregale deploy --no-traffic`, then
`gregale release mirror create` sends it a sample of production requests.
Callers always get the serving version's response. A summary counts the
copied requests that answered with a different status code, a different JSON
shape or, if you ask for it, a different value, and compares latency and
crashes. Traffic mirroring is in preview, on the Pro and Scale plans.

## What tests and canaries miss

Tests check the cases you thought of. A canary sends real users to the new
version: at 1%, one caller in a hundred gets its answer, good or bad.
Mirroring sits between the two. The new version sees the requests production
sees, with the odd query strings, the old mobile clients and the long tail of
IDs nobody put in a fixture, and nobody receives what it returns.

It fits changes where success means "the same answers as before": a rewrite
of an endpoint, a framework or runtime upgrade, a new ORM or query, a
dependency bump with a long changelog. Run the mirror before any real user
reaches the new version, and you start the rollout knowing how it answers.

## Mirror production to a staged release

```bash
gregale deploy --no-traffic                                   # stages v44 beside v43
gregale release mirror create --app my-api --source v43 --mirror v44 --percent 10
gregale release mirror summary --app my-api --id RULE_ID --window 24h
```

1. `--no-traffic` stages the new revision, waits until it is ready, and keeps
   production on the current one. It prints the revision's preview URL and
   the command that promotes it later.
2. `mirror create` copies 10% of the requests v43 serves to v44. Without
   `--percent`, the sample is 5%.
3. `mirror summary` reports on the last hour, or on the window you name:
   `1h`, `24h` or `7d`.

The summary counts the requests mirrored and how many answered differently,
and on what:

- **Status code**, such as a `200` from v43 and a `500` from v44.
- **Response shape**, the JSON schema of the body. A field that was renamed,
  dropped or changed from a number to a string shows up here.
- **Response value**, with `--include-body`. Bodies are compared by hash, and
  raw response bodies are never stored.
- **Latency and crashes**: the mean and p99 latency difference, and how often
  the candidate crashed.

Change or stop a rule while it runs:

```bash
gregale release mirror update --app my-api --id RULE_ID --percent 25
gregale release mirror update --app my-api --id RULE_ID --disable
gregale release mirror delete --app my-api --id RULE_ID
```

When you are satisfied, promote with the command the dark deploy printed:

```bash
gregale release traffic promote --app my-api --release v44 --if-serving v43
```

`--if-serving v43` makes the promotion fail with `traffic_serving_changed`
if another release took over production in the meantime.

## What is copied, and what is not

- **Reads only, by default.** POST, PUT, PATCH and DELETE requests are not
  copied unless you pass `--allow-unsafe-methods`. With it, the copy really
  runs those requests against the candidate, which can write to your
  database or call other services. Turn it on only when running those
  requests twice is harmless.
- **No credentials.** `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`,
  `Proxy-Authorization` and `WWW-Authenticate` are always removed from the
  copy, and `--redact-header NAME` removes any other header, such as a
  custom session token. The candidate therefore sees each copied request as
  an anonymous caller would; read differences on authenticated routes with
  that in mind.
- **Small, quick requests.** Requests with bodies over 64 KiB are not
  copied, and a copy gets at most 5 seconds.

## Replay the requests a sample might miss

A 10% sample can miss the rare request that matters: the slow export, the
payload from last week's incident. Save those requests and replay them
against the candidate:

```bash
gregale release mirror replay --app my-api --id RULE_ID --file corpus.json
```

A replay sends up to 100 saved requests, 8 MiB in all. POST, PUT, PATCH and
DELETE requests in the file need `--allow-unsafe-methods` on the command
line; the flag in the file alone is ignored.

## Limits

- One mirror rule per app on Pro and three on Scale; past that, the request
  fails with `422 mirror_rule_quota_exceeded`. Other plans get
  `403 plan_mirror_not_allowed`.
- Both revisions must be live, and they must be different revisions of the
  same app.
- The candidate wakes to answer the copies, and its running time is billed
  like any other instance. A higher `--percent` keeps it awake for longer.

## How other platforms handle it

| Platform            | Stage a version without traffic                                    | Copy live traffic to it                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Gregale**         | `gregale deploy --no-traffic`, with a preview URL                  | Built in (preview, Pro and Scale): sampled, credentials removed, responses compared on status, JSON shape, latency and crashes, and on value with `--include-body` |
| Google Cloud Run    | `--no-traffic`; a revision tag gives the revision its own test URL | Not covered by its rollout and traffic migration docs, which split real traffic between revisions by percentage                                                    |
| Istio on Kubernetes | A second version of the service in the mesh                        | `mirrorPercentage` sends copies "fire and forget" and discards the responses; the copy's Host header gets `-shadow` appended. Comparing the answers is up to you   |

With a service mesh you can copy traffic, but the comparison, which is the
part that tells you whether the release is safe, is yours to build from logs.
On Gregale the copy and the comparison are one rule on the release.

Sources, checked 2026-11-27:
[Cloud Run rollouts, rollbacks and traffic migration](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration),
[Istio traffic mirroring](https://istio.io/latest/docs/tasks/traffic-management/mirroring/).

## Pricing

Traffic mirroring is in preview, on the Pro and Scale plans. The
candidate's running time while it answers copies is billed like any
instance. See [Gregale pricing](/pricing), [Progressive rollouts](/docs/rollouts)
and [Canary deploys with automatic rollback](/articles/canary-deploys) for
how a release reaches real traffic in stages.
