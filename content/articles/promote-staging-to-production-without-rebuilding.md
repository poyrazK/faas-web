**Gregale promotes the exact immutable container artifact and pinned non-secret configuration tested in staging straight into production with `gregale environment promote`—without rebuilding from source, leaking staging credentials, or shifting live traffic before dark candidates pass health verification.**

> **Maturity:** Artifact + config snapshot promotion works today on complete project HTTP graphs. Health-verified promotion (`--verify`), complete service-graph regeneration, migration promotion (`--migrate`), and push-worker promotion (`--workers`) are rolling out per account (ask support to enable them); staging-to-production production secret staging (`--release-secrets-file`) and combined `--migrate --workers` promotions are not available yet.

## Which PaaS promotes the exact immutable artifact from staging to production without rebuilding from Git?

Most Git-push PaaS platforms rebuild source code on every environment branch, risking dependency or base-image drift between staging and production. Gregale snapshots the active staging release artifact and non-secret config graph directly so production runs the exact tested build:

| Capability           | Gregale (`gregale environment promote`)                                | Git-branch rebuild PaaS                             |
| -------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| **Artifact reuse**   | Reuses exact tested staging build artifact without recompiling         | Triggers a fresh source build in production         |
| **Secret isolation** | Production keeps its own secrets and bindings untouched                | Manual env syncing or shared variable groups        |
| **Rollback scope**   | `gregale environment cancel` restores graph + pinned config atomically | Revert Git commit and wait for another full rebuild |

## Why branch-per-environment rebuilds drift

On many PaaS platforms, moving from staging to production merges a Git branch and runs a second build. Even from the same commit, unlocked dependencies, base-image updates, build-time environment variables, or edited dashboard flags can mean production ships bytes that were never tested in staging.

## Promote exact artifacts with pinned configuration

```sh
gregale environment promote my-project --from staging --to production --sync-config --yes --wait
```

Gregale captures the complete active source HTTP release graph and its non-secret configuration snapshot, previews every changed key, and reuses the tested build artifact in production without rebuilding:

- **Secrets stay environment-owned:** Production keeps its own secrets, secret version pins, authentication credentials, and infrastructure bindings—never overwritten by staging credentials.
- **Approval and preview-hash fencing:** Protected production targets still enforce source qualification and approvals, and any variable or source change after preview invalidates the promote plan so stale approvals cannot apply.
- **Atomic rollback:** If promotion fails verification or is cancelled (`gregale environment cancel`), Gregale restores the previous graph and pinned configuration together without overwriting newer intentional production edits.

## Dark health verification, service graphs, migrations, and workers (per-account rollout)

Where enabled for your account, `--verify` adds pre- and post-cutover gates on read-only `GET`/`HEAD` probes (up to five project probes, minimum `21` minutes of revision retention):

```bash
gregale environment preview shop --from staging --to production --sync-config --verify
gregale environment promote shop --from staging --to production --sync-config --verify --yes --wait --progress --timeout 25m
```

1. **Dark preflight:** Candidates boot off live traffic and must pass **two complete healthy probe rounds one minute apart** (`10`-minute preflight deadline). Complete-graph mode rewires destination service URLs so private candidate services talk to candidate peers during preflight.
2. **Database expansion (`--migrate`, optional):** Runs one backward-compatible `release_command` (up to `10` minutes) before candidate checks. Interrupted tasks never auto-replay blindly; inspect the database and run `gregale environment migration recover --action resume|resolve` with an explicit evidence hash.
3. **Workers (`--workers`, optional):** Promotes up to `8` production push-queue workers alongside HTTP services, validating startup and real baseline queue deliveries before cutover (low traffic reports unknown and never fakes healthy).
4. **Atomic cutover + post-cutover verification:** Traffic flips atomically, followed by two additional healthy rounds before finalizing.

Up to `8` active promotions and `32` queued requests (`15`-minute queue wait; `429 project_promotion_queue_full` past capacity) are tracked durably on the server even if the CLI times out locally.

## Boundaries to know before adopting

- Pull/job workers, companions/sidecars, combined `--migrate --workers` in one promotion, promoting multiple workers concurrently from scratch, and staging destination secret rotations (`--release-secrets-file`) are outside verified promotion today.
- Because rollback restores code and config rather than undoing committed SQL schema edits, keep `--migrate` release commands backward-compatible with both the old and candidate codebases.

See [Environment promotion](/docs/environment-promotion), [Atomic project releases](/docs/project-releases), [Release safely](/docs/releases), [Canary deploys with automatic rollback](/articles/canary-deploys), and [Roll back a bad migration: code and database together](/articles/rollback-code-and-database).
