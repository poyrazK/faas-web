**On Gregale, a GitHub Actions workflow can deploy without any Gregale
secret in the repository: `gregale deploy --github` prints a workflow that
signs in with GitHub's own short-lived OIDC token.** `gregale github setup`
writes that workflow for you and can wait for your tests to pass first. For
GitLab, CircleCI or any other CI, a deploy token deploys one app and nothing
else. Both are on every plan, Free included.

## GitHub Actions: no stored key

```bash
# Print a starter workflow for the app
gregale deploy --github

# Or bind the repository, write the workflow and let it own production deploys
gregale github setup my-api --repo acme/my-api

# Deploy only commits your CI workflow passed
gregale github setup my-api --repo acme/my-api --wait-for CI
```

The workflow asks GitHub for an OIDC token and trades it for a short-lived
Gregale credential at deploy time:

```yaml
permissions:
  contents: read
  checks: write # publish the deployment link in GitHub Checks
  id-token: write # short-lived Gregale deploy bearer
steps:
  - uses: poyrazK/faas/.github/actions/deploy@<commit-sha> # v0
    with:
      api-base: 'https://api.gregale.dev'
      app: 'my-api'
      repo: '${{ github.repository }}'
      ref: '${{ github.sha }}'
      wait: 'true'
```

The Action is pinned to a commit, and Dependabot can update it from the
`# v0` comment. Gregale accepts the token only from the repository you
connected through the Gregale GitHub App, so a workflow in another
repository can't deploy with it. With `--wait-for CI`, a push deploys once your `CI`
workflow passes for that commit; a failed run, a pull request run or a run
from a fork deploys nothing.

## Other CI: a token for one app

```bash
gregale app deploy-token create --app my-api --label gitlab   # shown once; expires in 90 days
gregale app deploy-token list --app my-api
gregale app deploy-token rotate <token-id> --app my-api       # the old token stops working
gregale app deploy-token delete <token-id> --app my-api
```

Store it as `GREGALE_TOKEN` in your CI's secret store; then
`gregale deploy --name my-api --wait` deploys and follows the deployment to
the end. `GREGALE_TOKEN` takes precedence over any credential saved by
`gregale login`.

| A deploy token can                                                 | A deploy token can't                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------ |
| Deploy its app and apply the settings the deploy carries           | See or deploy any other app                            |
| Set its app's crons, routes and edge rules for the app's own hosts | Delete or rename the app                               |
| Read its app's deployments and preview status                      | Add log drains, mirrors or outbound webhooks           |
|                                                                    | Mint credentials or read debug requests and crash data |

If a token leaks, rotate it: the old one stops working at once.

## What we measured

We minted a deploy token on a test app on 2026-11-28 and ran the CLI with
only `GREGALE_TOKEN` set, no saved login:

- **Its own app:** `gregale deploy --wait` built and deployed it in 43 s.
- **Another app:** the deploy answered "no such app": the token can't see it.
- **Listing apps:** refused, naming the only routes the token may use.
- **Deleting its own app:** refused with "Deploy token scope is app-bound".
- **After `deploy-token delete`:** the next deploy was refused with "this
  deploy token has been revoked", and the error says to update the CI
  secret.

We generated the GitHub Actions workflow above; this test didn't run it on
GitHub.

## How other platforms compare

| Platform      | Deploying from CI                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Gregale**   | GitHub Actions signs in with OIDC, no stored secret; other CI uses a deploy token bound to one app, 90 days by default     |
| **Fly.io**    | `fly tokens create deploy` makes a token limited to one app; it is valid for 20 years unless you set `--expiry`            |
| **Railway**   | A project token, read from `RAILWAY_TOKEN`, is scoped to one environment of one project                                    |
| **Render**    | Each service has a secret deploy hook URL; a request to it deploys, so it must be kept like a password                     |
| **Vercel**    | Its GitHub Actions guide deploys with the Vercel CLI and a `VERCEL_TOKEN` secret                                           |
| **Cloud Run** | The `google-github-actions/auth` Action recommends Workload Identity Federation with GitHub OIDC over service account keys |

Checked against each vendor's public documentation on November 28, 2026:
[Fly.io access tokens](https://fly.io/docs/security/tokens/),
[Railway public API tokens](https://docs.railway.com/guides/public-api),
[Render deploy hooks](https://render.com/docs/deploy-hooks),
[Vercel: GitHub Actions](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel),
[google-github-actions/auth](https://github.com/google-github-actions/auth).

## Pricing

Deploy tokens, the GitHub Actions workflow and GitHub deploys cost nothing
extra on every plan: Free, Hobby ($10 a month), Pro ($30) and Scale ($99).
See
[Deploy from GitHub](/docs/deploy-from-github) and
[Gregale pricing](/pricing).
