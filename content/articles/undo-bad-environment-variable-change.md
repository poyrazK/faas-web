**On Gregale, a bad environment variable change on a live app is undone for
you: a config guard watches the first traffic after every change and, if the
app starts failing, restores the previous values and restarts it.** To see
what changed, and who changed it, run `gregale env history my-api`. To undo a
change that doesn't cause errors, set the old value again. Environment
variables and sealed secrets, history included, are on every plan.

## Undo it

```bash
# Every change, who made it and the guard's verdict
gregale env history my-api

# Put the old value back and restart with it now
gregale env set my-api LOG_LEVEL=info
printf 'LOG_LEVEL=info\n' | gregale env push my-api --from-stdin --restart

# Return plain variables to an earlier revision
gregale env rollback 12 --app my-api
```

What the history looked like after the guard undid a breaking change:

```text
Config guard: restored revision 1 after 5xx after the config change (new config 7/7, 100.0%; old config 0/16, 0.0%).
REV  WHEN                         CHANGE                 BY                    GUARD
6    2026-11-28T15:37:12.401198Z  guard restored 1       gregale:config-guard  -
5    2026-11-28T15:36:49.232647Z  secret.set MODE        api_key:…            restored
```

## What the config guard does

| Situation                                         | What happens                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| The new values cause server errors                | The guard restores the previous config and restarts the app                |
| Failing means                                     | At least 5 server errors that are at least half of the new-config requests |
| How long it watches                               | 10 minutes from the first request served with the new config               |
| No traffic arrives                                | It gives up after 24 hours                                                 |
| Several keys changed together, as `env push` does | They are judged and restored together                                      |
| You deleted or rotated a secret                   | Never restored automatically; the guard records the regression             |
| The change fixes an app that was already failing  | Never reverted                                                             |
| You're breaking a staging app on purpose          | Pass `--no-guard` to `env set` or `env push`                               |

The guard goes back to the config from before every change it is still
watching. In our test it restored revision 1, from before our first change,
so values we had set two minutes earlier, which were fine, were undone with the
failing one. Check `gregale env history` after a restore and set again
anything you still want.

## Secrets and `env rollback`

Values you set with `gregale env set` and `gregale env push` are stored as
sealed secrets. A config revision never holds a secret value, so
`gregale env rollback <revision>` can't put an old one back: it restores
plain variables and lists every secret that differs, with both versions, for
you to set again. The guard is different: it keeps replaced values, sealed,
for as long as it watches, so it can restore them.

A running instance keeps the environment it started with. Pass `--restart`
to apply new values now; otherwise they apply on the next cold wake.
Changes invalidate the app's snapshots, so an old value can't come back
through a restore.

## What we measured

We tested this on a small Node.js app on Gregale on 2026-11-28; it answered
`500` whenever `MODE=broken`:

- **A good change:** `env push --restart` of two values, served within 1 s.
- **A breaking change:** after pushing `MODE=broken`, the first `500` came
  3 s later. The guard restored the previous config 23 s after the push,
  after 7 failed requests (7 of 7 with the new config, 0 of 16 before it),
  and the app answered `200` from 26 s.
- **`env rollback` on a value set with the CLI:** it answered that the
  variables already matched the revision and listed the secret it had not
  restored, with both versions.

## How other platforms compare

| Platform    | Undoing an environment variable change                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------- |
| **Gregale** | A config guard restores the previous values when the app starts failing; `env history` shows every change         |
| **Heroku**  | `heroku rollback` creates a release that copies an earlier release's slug or image and its config vars            |
| **Render**  | A rollback reuses the target deploy's environment variables; it doesn't change environment group values           |
| **Vercel**  | Instant Rollback returns to an earlier build but doesn't update environment variables changed in project settings |

Checked against each vendor's public documentation on November 28, 2026:
[Heroku releases](https://devcenter.heroku.com/articles/releases),
[Render rollbacks](https://render.com/docs/rollbacks),
[Vercel Instant Rollback](https://vercel.com/docs/instant-rollback).

## Pricing

Environment variables, sealed secrets, config history and the config guard
cost nothing extra on every plan: Free, Hobby ($10 a month), Pro ($30) and
Scale ($99). The newest 100 revisions per scope are kept. See
[Environment variables](/docs/env#config-guard) and
[Gregale pricing](/pricing).
