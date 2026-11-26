**Prevent Friday-night outages, unauthorized schema migrations, and off-hours surprises with platform-enforced release approvals, deploy freezes, and scheduled rollouts.** Prompt checklists and Slack honor systems fail when an automated CI workflow, Friday afternoon push, or coding agent triggers `deploy` during peak traffic or incident recovery.

## Why team norms are not release safety controls

Git branch protection stops unreviewed merges, but does not stop someone with deploy access—or a CI workflow, GitHub Action, or AI agent—from pushing directly to production during a holiday freeze, redeploying after an incident rollback before a fix is ready, or running an irreversible database migration without a second pair of eyes.

## Multi-person release approvals and MFA sign-off

Require explicit human approvals before production releases advance past their first canary stage (or before running any database migration command):

```bash
# Two owners or admins other than the deployer approve every production release
gregale release approval require --approvals 2 --notify releases
# Require one approval (including developers) within 4 hours
gregale release approval require --approvals 1 --approvers developer --timeout 4h --notify releases
```

- **Human session enforcement:** API keys, CLI login tokens, and CI tokens cannot approve releases (`403 release_approval_session_required`). Approvers must sign into `/dashboard/releases/<deployment>/approval` (with MFA when enabled).
- **Migration safety:** If a release has a migration/release command, it pauses _before_ the command executes so rejecting or timing out (`24` hours default) prevents irreversible schema changes.
- **Always abortable:** Anyone authorized can reject immediately (`gregale release reject <deployment> --reason "..."`), while Slack or email approval links never depend on PagerDuty.

## Standing deploy freezes and post-rollback cooldowns

Block production releases across one app, your personal apps, or an entire organization on a one-off window, weekly schedule, or after automatic rollbacks:

```bash
# No weekend releases from Friday 16:00 to Monday 08:00 Istanbul time
gregale release freeze create --all-apps --weekly fri --at 16:00 --for 64h --tz Europe/Istanbul --reason "no weekend releases"
# Automatically freeze an app for 1 hour if canary/5xx rollback triggers
gregale release freeze create --app my-api --after-rollback 1h --reason "settle after automatic rollbacks"
# Organization-wide holiday freeze
gregale release freeze create --org acme --for 72h --reason "holiday freeze"
```

Active freezes return `release_frozen` across `gregale deploy`, API requests, GitHub pushes, and promotions into `production`, while **never blocking rollbacks, in-progress rollouts, previews, or secret rotations**. Emergency hotfixes (`gregale deploy --override-freeze "hotfix for incident 4711"`) require owner/admin or window-creator permission and emit `release.freeze_overridden` audit records.

## Build now, roll out at a scheduled quiet window

Separate build validation from traffic cutover by building immediately and scheduling the rollout for an off-peak hour or launch window:

```bash
gregale deploy --at 02:00 --release-notify releases
gregale release schedule set v44 --app my-api --at +30m
```

Builds, readiness checks, and snapshots finish right away while you are at your keyboard, keeping the candidate live at 0% traffic without waking idle VMs. Before starting at the scheduled minute, Gregale re-checks active freezes, approval policies, and newer superseding releases (expiring cleanly if blocked past one hour).

## Tradeoffs and scope boundaries

Release approvals apply to request-mode apps in production (`default` scope or project `production` environment) so every waiting release has a canary stage to pause in; previews, staging environments, background workers, and jobs deploy without waiting on production approval policies. During severe platform security incidents, a temporary platform-wide `503 platform_release_paused` pause also holds new releases while letting running apps and rollbacks continue uninterrupted.

See [Release approvals, freezes and schedules](/docs/release-controls), [Rollouts](/docs/rollouts), [Canary deploys with automatic rollback](/articles/canary-deploys), [Human approval before an AI agent changes production](/articles/ai-agent-production-approval), and [Gregale pricing](/pricing).
