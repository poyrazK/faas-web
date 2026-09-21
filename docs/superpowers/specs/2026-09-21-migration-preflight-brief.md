# Migration preflight — "Will it run here?"

Goal prompt for implementation. Written 2026-09-21.

## The goal

A public, zero-signup web check that answers **"would my app run on Gregale?"**
for someone who is already deployed elsewhere and is afraid to move.

Paste a public GitHub URL or an OCI image reference. Get a verdict in seconds.
No install, no account, nothing to lose.

## Why this, and why it beats the alternatives

Everyone worth targeting is already deployed somewhere. The blocker is not
awareness, it is switching cost. The four fears, in the order people feel them:
_will it work, what will it cost, how long will it take, what breaks._

**The tool must be allowed to say no.** A confident "this writes to local disk,
it will not work here" is a better outcome than a signup followed by a failed
deploy. The honesty is the conversion mechanism, not a caveat on it — same
principle that made the pricing answer credible.

The property that makes this a GTM tool rather than a docs page: it runs on
**someone else's** repo. You can check a stranger's project and open the
conversation with a finished result instead of a pitch, and the shareable
permalink is the migrate-for-you offer without doing the migration first. It
also consumes GitHub code-search targeting directly — find `render.yaml` /
`fly.toml` / `Procfile` repos, check them, message the ones that come back green.

## v1 scope — static analysis only

No builder VM. The contract gate is already metal-free; keep it that way.

**In scope**

- Input: a public GitHub repo URL, or an OCI image reference
- Fetch the repo tarball (public only, no auth, size-capped) or the image manifest
- Run existing detection and produce a verdict
- Verdict: **runs** / **runs with changes** / **will not run**, each with specific reasons
- Per finding: what was detected, what it implies, what to change
- Cost estimate from the detected RAM profile against the plan table
- Shareable permalink to the report

**Explicitly out of v1**

- Actually building the app in a builder microVM (this is v2, and it is the
  convincing version — do not let it creep into v1)
- Private repos, OAuth, any credential handling
- Deploying anything
- Accounts, or persistence beyond the cached report
- Non-GitHub sources

## Reuse, do not rebuild

The engine largely exists. Read these before writing anything:

- `pkg/frameworkprofile` — `Analyze(fs.FS)`, `AnalyzeTarballAtRoot(archive, root)`,
  returning `Profile` with `Warning`s. This is the detection core and it needs no VM.
- `pkg/apihostingcontract` — `Fixture`, `ValidateContainerContract`, the catalog.
- `docs/container-compatibility.md` — the portability boundary is already written
  down. Its disqualifier list _is_ the rule set: non-Linux/amd64, OCI volumes or
  host mounts expecting durable storage, privileged mode, host devices, host
  networking, Docker socket, no HTTP listener on `0.0.0.0:$PORT`, state on local disk.
- `pkg/api/limits.go` — every quota and price. Never inline a limit.
- `gregale doctor --image` — the existing CLI equivalent. Keep the verdict
  vocabulary consistent with it; two different answers to the same question is worse
  than no tool.

## Verdict rules

- **Green** — stateless HTTP, Linux/amd64, listens on `$PORT`, fits a plan RAM tier.
- **Amber** — needs a declared change: explicit port, start command override,
  health path, full-rootfs opt-in.
- **Red** — any hard disqualifier from the container contract.

Bias toward amber and red. A false green is the only failure mode that actually
costs you a user.

## Repo conventions that apply

**faas** — never push to `main`, PR and squash merge. Errors wrapped with `%w`;
API errors are RFC 7807 with a stable `code`. Money in integer millicents, no
floats. Handlers ≤50 lines, table-driven tests. Any new limit goes in
`pkg/api/limits.go`. `slog` JSON logs, Prometheus names as specced.

**faas-web** — `npm run check` is the gate; lint ceiling is `--max-warnings 8`.
No literal hex and no `dark:` variants; new colours need a token in _both_
`:root` and `.console`. No fixture data in `src/` — if an endpoint cannot answer
something, say so in the UI. A new route needs a `head` via `consoleHead`/`pageHead`.
`routeTree.gen.ts` and `lib/api/schema.d.ts` are generated — never hand-edit.
Branch on `ApiError.code`, never on status or prose.

## Open decisions — defaults chosen, override if wrong

1. **Endpoint home:** an unauthenticated, rate-limited public route in `apid`
   alongside `/status`. Chosen because `frameworkprofile` already lives in `faas`
   and this avoids a new deployable.
2. **Abuse controls:** per-IP rate limit, tarball size cap, fetch timeout, no
   redirects off `github.com`. Cache by commit SHA so re-runs are free.
3. **Report persistence:** store the verdict keyed by `owner/repo@sha` so the
   permalink is stable. Needs a table and a migration.
4. **Page location:** `/will-it-run` in `faas-web`, outside `/dashboard` — it must
   work with no session.

## Security — non-negotiable

This is an unauthenticated endpoint that fetches a user-supplied URL, which is a
textbook SSRF. Pin the host to `github.com`, refuse redirects off it, resolve the
target and **reject RFC1918, link-local, and metadata ranges** before connecting —
the same rule already applied to tenant egress in §11. Cap response size and time.
Never log secret values.

## Definition of done

- Paste a public GitHub URL, get a verdict in under 5s for a typical repo
- At least one honest **red** case works end to end (a repo that needs durable
  local disk, say) — the no path is the feature, so it ships tested
- Permalink re-renders the same report without re-fetching
- `npm run check` green; `make test` and `make lint` green
- SSRF protections covered by tests, not just asserted
- Lands as a PR against a feature branch. Nothing merged to `main`, nothing
  exposed publicly, until reviewed.
