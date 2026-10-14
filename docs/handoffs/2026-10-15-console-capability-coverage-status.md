# Console capability coverage: delivered and remaining

As of October 15, 2026 (Europe/Istanbul). All listed work is pushed. Nothing was merged or deployed by this implementation session. GitHub preview builds and mock walkthroughs do not establish provider, staging or execution health.

## PR and issue coverage

Issue closure is conditional on default-branch integration and the dependencies below. Stacked PRs do not close their issues merely by being opened. Parent [#134](https://github.com/poyrazK/faas-web/issues/134) remains open.

| Scope                                      | Frontend PR                                                                                                                                                      | Issue covered                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| A: discovery and storage guards            | [#144](https://github.com/poyrazK/faas-web/pull/144)                                                                                                             | #136                                    |
| B: HTTP image deployments                  | [#145](https://github.com/poyrazK/faas-web/pull/145)                                                                                                             | #137                                    |
| C: projects and archive import             | [#146](https://github.com/poyrazK/faas-web/pull/146)                                                                                                             | #138                                    |
| D: environments and selected preview roots | [#147](https://github.com/poyrazK/faas-web/pull/147)                                                                                                             | #139; full root index remains separate  |
| E: policy and purge convergence            | [#148](https://github.com/poyrazK/faas-web/pull/148)                                                                                                             | #140                                    |
| F: Stripe inbound webhooks                 | [#159](https://github.com/poyrazK/faas-web/pull/159)                                                                                                             | #149                                    |
| G: instrumented Issues                     | [#160](https://github.com/poyrazK/faas-web/pull/160)                                                                                                             | #150                                    |
| H: internal services                       | [#162](https://github.com/poyrazK/faas-web/pull/162)                                                                                                             | #151                                    |
| I: consumers, workers, stage bindings      | [#163](https://github.com/poyrazK/faas-web/pull/163), [#164](https://github.com/poyrazK/faas-web/pull/164), [#165](https://github.com/poyrazK/faas-web/pull/165) | #165 closes #152 with both predecessors |
| J: cache rules and targeted purge          | [#166](https://github.com/poyrazK/faas-web/pull/166)                                                                                                             | #153                                    |
| K: Recently deleted and reviewed restore   | [#173](https://github.com/poyrazK/faas-web/pull/173)                                                                                                             | #154, after backend dependencies        |
| L1: deployment companions                  | [#175](https://github.com/poyrazK/faas-web/pull/175)                                                                                                             | #155, after backend dependency          |
| L2: MCP setup and CLI guidance             | [#174](https://github.com/poyrazK/faas-web/pull/174)                                                                                                             | #156                                    |
| L3: OpenAPI policy comparison              | [#169](https://github.com/poyrazK/faas-web/pull/169)                                                                                                             | #157                                    |
| M: readiness and durable receipt reads     | [#176](https://github.com/poyrazK/faas-web/pull/176)                                                                                                             | Part of #158; does **not** close it     |

The original A–J stack is preserved. K, L1, L2, L3 and M each branch independently from J; none adds commits to an A–E PR head.

### Mergeability snapshot

All frontend PRs above are OPEN and MERGEABLE against their declared bases. Through #175 their checks are successful and GitHub reports CLEAN. The new #176 reports UNSTABLE with its `check` job queued and preview build successful. A later documentation-only push restarts its checks; local product verification below remains the recorded evidence.

Backend dependencies:

| PR                                                     | Status and purpose                                                                                                                                                                                                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [faas#4614](https://github.com/poyrazK/faas/pull/4614) | Draft, MERGEABLE/BLOCKED. Account-owned deleted-app store foundation; existing CI failures tracked in #4635.                                                                                                                               |
| [faas#4632](https://github.com/poyrazK/faas/pull/4632) | MERGEABLE/UNSTABLE, fresh CI queued. Owned bounded inventory/exact-ID reads and reviewed restore API; depends on #4614. Latest head `081f54b63749f1051b70994776c1af000ca41831` includes the gofmt fix and external-package test migration. |
| [faas#4733](https://github.com/poyrazK/faas/pull/4733) | MERGEABLE/BLOCKED, fresh CI queued. Safe companion declarations and SDKs, head `ec6af187a4d7f0658fa120f9fb79cd12f32399e3`. Supersedes conflicted #4638, which was closed without merging; original branch/history retained.                |

MERGEABLE describes conflict detection. It does not mean required checks, dependency integration or release qualification have completed.

## K–M delivered behavior

### K: deleted-app recovery

Account-owned, bounded Recently deleted inventory uses server deletion/grace metadata and explicit restore eligibility. Review and submit refresh the exact deleted-app identity. Nonsecret attempt identity survives reload; an ambiguous response reconciles through exact-ID reads without automatic replay. Quota, expiry, collision, account isolation and recoverable failures use fixtures. No live app was deleted to test.

### L1: companions

Configure → Companions selects a real deployment with bounded, URL-backed history. The backend projects actual persisted declarations: resources, dependencies and environment key names. Environment values, secret references, commands and unexpected fields are excluded. Known empty, unavailable metadata and failed reads remain distinct. Missing health telemetry is Unverified. Source manifest/CLI handoff remains explicit; no automatic probes are run.

### L2 and L3

MCP guidance checks capability and streaming availability, explains deployment/client/auth/catalog setup and shows the documented CLI doctor/config/tools/resources/prompts commands. Browser diagnostics and tool execution are absent; enabled capability does not imply verified protocol support.

OpenAPI comparison displays matched, declared-only and observed-only routes with matching policies. Partial/unavailable observation stays distinct from a healthy empty observation. Existing import/dry-run journeys remain available. Policy coverage does not prove correctness.

### M: limited read delivery

Environment detail reads promotion preview, bounded promotion history, exact durable operation checkpoints and known approval IDs. It preserves source revision, returned hashes, release/qualification/approval identities and expiry. URL filters/cursors reset when their context changes. Queries whitelist metadata and sanitize errors before cache retention; config values and tokens are excluded.

Promote, rollback, full clone and GitOps enforce remain gated. Stale review requires a fresh preview; there is no automatic resubmission, restart or rollback. This is a useful read journey, not full M implementation or native acceptance.

## Verification recorded

Behavioral regressions were watched RED before implementation/fixes and GREEN afterward. Each deliverable received one fresh GPT-6.1 Sol/High final review. Reviewer findings about cached object IDs, raw API errors and approval UUID spelling were fixed before publication.

| Frontend scope | Full check                                       | Production build |
| -------------- | ------------------------------------------------ | ---------------- |
| K              | 247 files / 1,755 tests; type/lint/format passed | 31 routes        |
| L1             | 242 files / 1,749 tests; type/lint/format passed | 31 routes        |
| L2             | 243 files / 1,747 tests; type/lint/format passed | 31 routes        |
| M              | 242 files / 1,751 tests; type/lint/format passed | 31 routes        |

Mobile/keyboard, reload/history, pagination, failed/delayed reads and account/app/environment changes were exercised with mocks. L1/L2/M walkthroughs made zero writes and had zero page errors. K performed only deliberate fixture restore requests. Four existing lint warnings and duplicate React-key warnings in storage sibling fixtures remain.

Backend K store fixtures passed MemStore and actual PostgreSQL tests, migrations/index/SQLc/vet/build checks. Current K API external routed regressions pass. Prior broad backend runs had unrelated pagination/multipart/timing failures documented in the ledger; those runs are not reported green.

On L1 base `c70cf7689d54f61f162159ebbc102a29f31aa542`, full API and deployment-read suites, actual routed ownership/scope/MFA/legacy-GET tests, AST compliance, SDK coverage, mirrored specs, gofmt/diff and generated Python syntax pass. OpenAPI lint passes with 3,365 warnings and 314 informs. The successor preserves reviewed behavior; conflict resolutions only join additive imports and generated exports. Default main advanced again before PR creation; remote CI is the integration gate for that newer base.

## Remaining work and blockers

1. **Integration:** keep all PRs unmerged as requested. Required remote CI and backend dependencies must pass before later integration. Frontend K needs backend #4614/#4632; L1 needs #4733. No manual issue closure was performed.
2. **K backend CI:** [faas#4635](https://github.com/poyrazK/faas/issues/4635) records the store PR's codegen/server-growth and PostgreSQL route-monitor failures. The API gofmt failure is fixed and pushed. These facts do not make the store's failed CI green. Later main removed the historical server size guard; its old result is not current policy.
3. **Full M:** [faas#4729](https://github.com/poyrazK/faas/issues/4729) and [faas-web#158](https://github.com/poyrazK/faas-web/issues/158) remain open. Full clone deliberately returns conflict; customer enforce returns `environment_git_enforcement_unavailable`. Production qualification polling, full graph activation and continuous enforcement require separate backend/native qualification, including the documented dedicated Linux x86_64 KVM acceptance. Traffic-moving/destructive controls need separately authorized isolated staging qualification before enabling them.
4. **Complete preview-root inventory:** [faas#4390](https://github.com/poyrazK/faas/issues/4390) remains open. D intentionally uses app-backed candidates and selected-root inspection.
5. **Separate follow-ups:** ownership-rule replacement/impact-alert editing, private transport qualification and browser MCP diagnostic safeguards remain separately scoped. No placeholders or docs-only handoffs are claimed as those implementations.

## Resume identities

Frontend worktree: `/mnt/d/gregale/.codex-worktrees/faas-web/landing-copy`. Current branch: `feat/console-environment-readiness`; product head `8258fd037629b31070eb43ae67f91d5c0759f0bd`, followed by this documentation commit. J dependency: `26e6234aa3d3d40281529684fc8cba86421d208c` (`feat/console-cache-rules-purge`).

K backend worktree: `/mnt/d/gregale/.codex-worktrees/faas/account-deleted-app-inventory`, local follow-up head `d769c2f5314142693d79dc2a5c32bb598de10a69`; published equivalent tree at `081f54b63749f1051b70994776c1af000ca41831`.

L1 backend worktree: `/home/bahadir/.codex-worktrees/faas/deployment-companion-read-current`, local head `ef337a301d0ffe8a24a6ca0e1b2cbb2a62b1af00`; published equivalent tree at `ec6af187a4d7f0658fa120f9fb79cd12f32399e3`.

Both dirty main checkouts remain untouched. Detailed logs and chronological ledgers are retained under the frontend worktree's ignored `.superpowers/sdd/` directories for K, L1, L2 and M. The workspace resume copy is `/mnt/d/gregale/.codex-handoffs/console-capability-coverage-2026-10-12-resume.md`. Resume from the blockers above; do not repeat A–L implementation or its completed reviews.
