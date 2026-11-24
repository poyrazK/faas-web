**Gregale creates a preview environment for every pull request on its own.**
Connect a GitHub repository and each pull request gets a live copy of the app
at `https://pr-<number>-<app>.gregale.dev`, rebuilt on every push and torn down
after the pull request closes. There is no CI workflow to write and no DNS or
certificate to set up. When the app depends on other services in the project,
the preview runs the pull request's version of those too. Pull-request
previews are generally available on every plan, including Free.

## How it works

1. **Open a pull request.** The Gregale GitHub App builds the pull request's
   head for the app the repository deploys, plus the services it declares it
   depends on.
2. **Get a URL and a status.** The preview answers at
   `https://pr-<number>-<app>.gregale.dev`. Gregale keeps one comment on the
   pull request up to date with the URL, the commit and links to logs, reports
   a `gregale-preview` check that stays in progress until every service is
   live at that commit, and records each preview in GitHub's Deployments
   timeline.
3. **Push again.** Every push rebuilds the preview at the new head. Changes
   only to paths you mark as ignored, such as docs, skip the rebuild.
4. **Close or merge.** The preview keeps serving for 24 hours so reviewers can
   look one last time, then it is torn down. Previews also expire after a
   time to live: 7 days by default, settable from 1 hour to 30 days.

A preview is an ordinary Gregale app: it wakes on its first request and
pauses when nobody is using it. Your CI can wait for it to be live at the
pull request's head and run tests against it. Exchange the job's GitHub OIDC
token for a read-only preview token, so no key is stored where pull requests
can read it:

```bash
FAAS_TOKEN=$BEARER gregale preview wait "pr-$PR_NUMBER-shop-api" --commit "$HEAD_SHA" --timeout 15m
```

## Safe by default

A preview runs code nobody has reviewed yet, so Gregale keeps it away from
production:

- **No production configuration.** Production environment values are not
  copied into previews, and managed database and storage credentials are
  never given to them. Give previews test values in the production app's
  `pr-preview` scope:
  `gregale env set --app shop-api --env pr-preview STRIPE_KEY=sk_test_…`.
- **No calls into production.** A preview reaches the pull request's own
  previews of other services. Calls to production services are refused unless
  you opt in for services that are safe to call.
- **Same front door as production.** Previews keep the production app's
  access gates (password, API keys, IP allowlists and edge rules), so a
  private API stays private.
- **No untrusted pull requests.** Pull requests from forks are skipped, and so
  are pull requests opened by bots such as Dependabot unless you turn them
  on. Draft pull requests get previews by default.
- **Not indexed.** Previews tell search engines not to index them.

## How many previews each plan includes

Each open pull request with a preview uses one PR preview environment,
however many services it runs: Free includes 1, Hobby 2, Pro 5 and Scale 20.
A closed pull request frees its environment straight away, even during its
24-hour grace period.

## How other platforms compare

| Platform             | Previews built in                                                                                         | What a preview includes                                                              | What you set up                               |
| -------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| **Gregale**          | Yes, on every plan including Free                                                                         | The app and the services it declares it depends on, at the pull request's head       | Connect the repository                        |
| **Heroku**           | Review apps, with Heroku Pipelines and the GitHub integration                                             | An app per pull request, billed like a normal app while it exists                    | A pipeline and the GitHub integration         |
| **Render**           | Preview environments need a Render Pro workspace or higher; single-service previews are a separate option | A copy of the whole Blueprint, services and datastores                               | `previews.generation` in `render.yaml`        |
| **Railway**          | PR environments: a temporary environment per pull request, deleted when it is merged or closed            | A temporary environment for the project; only pull requests from team members deploy | Turn them on in the project settings          |
| **Fly.io**           | Not built in. Fly.io's GitHub Action creates a review app per pull request                                | An app at `pr-<number>-<owner>-<repo>.fly.dev`                                       | A workflow file and a Fly.io API token secret |
| **Google Cloud Run** | Not built in. Revision tags give a deployed revision its own URL                                          | Whatever your pipeline deploys                                                       | A CI pipeline that builds, tags and cleans up |

Checked against each vendor's own documentation on November 24, 2026:
[Heroku review apps](https://devcenter.heroku.com/articles/github-integration-review-apps),
[Render preview environments](https://render.com/docs/preview-environments),
[Railway environments](https://docs.railway.com/environments),
[Fly.io review apps guide](https://fly.io/docs/blueprints/review-apps-guide/),
[Cloud Run traffic migration and tags](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration).

## Set it up

```bash
gregale github connect                          # install the Gregale GitHub App
gregale github link shop-api --repo acme/shop-api
```

Pushes to the production branch now deploy the app, and pull requests into it
get previews: they are on by default. The project's GitHub deployment policy
sets how long previews live and which paths, such as `docs/**`, skip a
rebuild. See [Deploy from GitHub](/docs/deploy-from-github) and
[PR preview environments](/docs/preview-environments).
