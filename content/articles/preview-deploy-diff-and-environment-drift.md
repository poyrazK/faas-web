**Preview every setting change, quota conflict, config-key delta, package upgrade, and cross-environment drift—with a single `blocking` boolean for CI—without exposing a single plaintext secret.** Gregale provides read-only pre-deploy diffs (`gregale deploy --diff`), release-to-release SBOM diffs (`gregale release diff`), hashed secret matrices (`env-diff`), and project environment diffs across staging and production.

## Why blind deploys fail teams and AI agents

Traditional `git push` PaaS platforms execute builds immediately and surface configuration or quota surprises only halfway through a rollout. Worse, comparing `staging` and `production` across separate services usually means dumping `.env` files into terminals and manually diffing container tags.

For CI pipelines and AI coding agents, you want a read-only equivalent of `terraform plan` across app config, releases, packages, and environment drift.

## Pre-deploy diff: check quota and breaks before deploying

Run `gregale deploy --diff` locally or call `POST /v1/apps/{slug}/diff` from CI:

```http
POST /v1/apps/my-api/diff

{"image": "ghcr.io/me/api@sha256:abc", "app_config": {"ram_mb": 512, "max_concurrency": 30}}
```

The endpoint returns a structured `DiffResponse` without creating any database row, audit entry, or deployment—even when the app does not exist yet (`would_create_app` + quota evaluation):

```json
{
  "diff": {
    "slug": "api",
    "plan": "hobby",
    "changes": [{ "field": "memory", "kind": "modify", "before": 256, "after": 512 }],
    "breaks": [
      {
        "code": "plan_limit_concurrency",
        "severity": "error",
        "reason": "max_concurrency exceeds plan cap",
        "field": "concurrency",
        "observed": 30,
        "limit": 20
      }
    ]
  },
  "blocking": true
}
```

- **One boolean for CI gates:** Pipe `jq '.blocking'` to fail builds before triggering a deploy when any `severity: "error"` break is present.
- **No MFA required for read-only checks:** `POST /v1/apps/{slug}/diff` accepts a bearer key with `apps:read` or `deploy:write`. Note that `/diff` checks app config, limits, and text-level handler/entrypoint/env-key warnings; full OpenAPI schema compatibility is gated separately via `/v1/apps/{slug}/openapi/diff` (see [OpenAPI breaking-change deploy gate](/articles/openapi-breaking-change-deploy-gate)).

## Compare two live releases including commits and SBOM packages

Inspect everything a release changed against the previous release or any historical version:

```sh
gregale release diff v42                 # against the release serving before it
gregale release diff v42 --against v38   # against any release of the app
```

Backed by `GET /v1/deployments/{id}/diff`, Gregale compares:

- **Code:** Both commits, a GitHub compare link when both releases share a repository, and whether the container image digest changed.
- **Configuration keys:** Env variables and secrets added, removed, or changed by key name—**never returning variable values or secret fingerprints**.
- **Packages:** Dependencies added, removed, or upgraded between the two builds' SBOMs (up to `100` per list; image-only deploys omit build SBOMs).
- **Runtime settings and release command:** Handler, runtime base, port, entrypoint, command, probes, minimum instances, sidecars, workflows, env override keys, and database migration release commands.

Config history retains the last `100` revisions per scope, and the same comparison is embedded directly on release approval pages and `gregale release timeline v42`.

## Spot environment drift without exposing secrets

- **Scope matrix (`GET /v1/apps/{slug}/env-diff`):** Returns a `rows × scopes` matrix of variables and sealed secrets where secret cells return `{present, value_hash}`—so you verify parity across scopes without revealing plaintext.
- **Project environment diff (`gregale environment diff shop --from production --to staging`):** Backed by `GET /v1/projects/{slug}/environments/{environment}/diff`, compares effective project environment configuration, workload releases, variable/secret metadata, environment-bound custom domains, and declared routes.

## How other platforms compare

| Platform      | Read-only pre-deploy diff + `blocking` boolean                                  | Release-to-release SBOM + config diff                                      | Secret-hashed scope & env drift diff                 |
| ------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------- |
| **Gregale**   | Yes (`gregale deploy --diff`, `POST /v1/apps/{slug}/diff`, **beta**, all plans) | Yes (`gregale release diff`, commits + SBOM + runtime + migration command) | Yes (`env-diff` hashes + `gregale environment diff`) |
| Terraform CLI | Yes (`terraform plan` for IaC resources)                                        | Tracks IaC state, not build SBOMs                                          | Depends on remote state backends                     |
| Render        | Preview Blueprint YAML manually                                                 | Deployment commit logs only                                                | Manual inspection in Env Groups                      |
| Railway       | Graph change staging before Deploy                                              | Deployment logs & service vars view                                        | Compare environments visually                        |
| Fly.io        | `fly deploy --dry-run` / config inspection                                      | `fly releases` history                                                     | No built-in multi-app SBOM + env-hash matrix         |

Sources, checked 2026-11-27:
[HashiCorp Terraform `plan`](https://developer.hashicorp.com/terraform/cli/commands/plan),
[Render Blueprint Specification](https://render.com/docs/blueprint-spec).

## Pricing and docs

Pre-deploy diff (`deploy-diff`, in beta), release diffs, and environment diffs are available on all plans including Free. See [Gregale pricing](/pricing), [Deployments & releases](/docs/releases), [Environment variables & config guard](/docs/env), [Deploy diff API](/docs/api/deploydiff), and [Block breaking OpenAPI changes on deploy](/articles/openapi-breaking-change-deploy-gate).
