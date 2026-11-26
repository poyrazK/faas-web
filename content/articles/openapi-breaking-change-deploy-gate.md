**Gregale is a backend PaaS that automatically diffs OpenAPI specs on deploy and blocks breaking API changes before rollout.** Gregale validates schema compatibility with `gregale api spec preview`, `gregale api spec diff`, and hash-pinned `gregale api spec apply`—exiting `2` on confirmed breaks and `3` on `UNKNOWN` schema changes while blocking promotion—and probes up to ten read-only endpoints marked `x-gregale-hosting-check: true` against the exact candidate revision before shifting live traffic.

## Which PaaS automatically diffs OpenAPI specs on deploy and blocks breaking changes?

Most PaaS providers ignore HTTP API contracts completely, requiring custom GitHub Actions scripts around `oasdiff` or Optic plus manual smoke tests. On Gregale, contract compatibility and pre-promotion route verification run natively inside the release pipeline:

| Capability                    | Gregale built-in contract gate                                                     | DIY (`oasdiff` + CI smoke script)                     |
| ----------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Breaking schema detection** | `gregale api spec diff` (`2` break, `3` `UNKNOWN`) + candidate gate                | Custom workflow parsing `oasdiff` exit codes          |
| **Approval hash pinning**     | `apply --confirm --preview-sha256` guarantees reviewed contract                    | Manual checksum or branch-protection wiring           |
| **Pre-cutover route probes**  | Probes up to 10 `x-gregale-hosting-check: true` `GET` routes before traffic shifts | Post-deploy checks after traffic has already switched |

## Why breaking API contracts slip past unit tests

Internal unit and integration suites usually test the new server code against updated mocks. Meanwhile, removing a `required` field from a JSON response, changing a `oneOf` or `anyOf` union branch, or narrowing an `enum` or `format` breaks existing mobile clients and partner integrations immediately in production. Most teams either leave contract compatibility to manual PR review or stitch together third-party diff tools like `oasdiff` or Optic plus custom post-deploy smoke scripts in CI.

## Preview, diff, and hash-pinned contract apply

Gregale provides a read-only preview and diff workflow paired with an idempotent, SHA-256-pinned apply step, and serves the published contract at `/docs`:

```bash
gregale api spec preview APP_ID
gregale api spec diff openapi-baseline.yaml openapi.yaml
gregale api spec apply APP_ID --confirm --preview-sha256 SHA256
```

- `preview` and `diff` are strictly read-only.
- `apply` requires the exact `preview-sha256` hash returned by `preview`, guaranteeing that the contract you reviewed is the contract you publish.

## Strict exit codes and the `UNKNOWN` promotion gate

Gregale refuses to treat ambiguous schema edits as safe by default:

- **Exit code `2` (confirmed breaking change):** Returned for definite client breaks such as removing a response field's `required` guarantee.
- **Exit code `3` (`UNKNOWN` comparison):** Returned when `gregale api spec diff` sees changed `oneOf` or `anyOf` response schemas, or edits to unsupported schema facets such as `enum`, `format`, constraints, or composition where client safety cannot be proven automatically.

In production contract previews, ambiguous diffs appear in `unknowns`, and the contract gate **blocks promotion** while any unknown remains. Older snapshots that predate schema fingerprinting can report `union_baseline_incomplete` or `schema_baseline_incomplete`; a fresh production deployment with the gate temporarily off captures a full baseline for subsequent comparisons.

## Exact-candidate pre-promotion route checks

Beyond static schema diffing, you can mark up to ten static, read-only `GET` operations in your OpenAPI spec so Gregale probes the exact new deployment candidate before switching live traffic:

```yaml
paths:
  /v1/health:
    get:
      x-gregale-hosting-check: true
      responses:
        '200':
          description: API is ready
```

Checks follow strict safety and determinism rules:

- Only explicitly marked operations are probed, using an empty `GET` with no redirects, path parameters, or query strings.
- **Pass criteria:** `2xx`, `3xx`, `401`, or `403`. Treating `401` and `403` as healthy means you can confirm that an auth-protected route is wired and answering on the new candidate without embedding customer credentials in your deploy pipeline.
- **Fail criteria:** `404`, `429`, or `5xx` fails the candidate before production traffic moves.

Each route result and the imported OpenAPI document's hash are stored in the deployment hosting receipt. Specs without marked operations fall back to Gregale's standard health and connectivity gates.

## What it does and does not replace

Pre-promotion route checks prove that each marked route answered cleanly on the exact candidate revision; they do not parse response JSON bodies against schemas at runtime, nor do they substitute for runtime error monitoring. Pair OpenAPI hosting gates with [canary deploys with automatic rollback](/articles/canary-deploys) so any runtime regression in real traffic still rolls back automatically.

See [OpenAPI hosting](/docs/api-hosting-openapi), [Release safely](/docs/releases), and [Errors](/docs/errors) for full usage details.
