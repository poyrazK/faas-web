# Rollouts and rollback

Every deploy on Gregale can take traffic gradually, watch its own error rate, and hand traffic back on its own when something breaks. This page covers the whole release path: canary splits, automatic rollback on 5xx, recovering a stuck rollout by hand, rolling back on purpose, shadowing a candidate with mirrored traffic, and retrying a failed build from the stage that broke.

## How a deploy takes traffic

A deployment carries a `traffic_percent`. A plain deploy goes straight to 100%; a canary starts at a slice and steps up as its health gate stays green. You can set the split by hand at any time:

```
gregale traffic set <slug> --deployment <id> --percent 25
```

In the console: the app's **Deployments** tab shows each deployment's share, and a banner appears whenever a rollout is mid-flight.

## Automatic rollback on 5xx

Each app can arm `rollback_on_5xx`: when the newest deployment starts answering with server errors, the platform counts them (`first_5xx_count` on the deployment records where that started) and returns traffic to the previous deployment without waiting for a human. Arm it in the console under **Configuration**, or leave it off for apps where a burst of 5xx is expected — a dependency doing maintenance, say.

## Rolling back on purpose

```
gregale rollback <slug>
```

returns all traffic to the previous successful deployment. In the console: the app page's **Rollback** button, visible whenever there is a deployment to roll back to. Traffic moves; the bad deployment stays around for inspection.

## Recovering a stuck rollout

When a canary stalls — the health gate never resolves, or on-call wants it over now — recovery is manual and explicit:

```
gregale rollouts recover <slug> --action advance|promote|abort --reason "…"
```

- **Advance** moves to the next traffic step now instead of waiting for the timer.
- **Promote** sends all traffic to the new deployment and finishes the rollout.
- **Abort** returns all traffic to the previous deployment.

The reason is optional on the wire, but it lands in the audit log next to the transition's `audit_id` — six months later that sentence is the difference between a mystery and a record. In the console: the rollout banner on the **Deployments** tab offers all three, with abort and promote asking first.

## Shadowing before you switch

A mirror copies a share of one deployment's live requests to another and measures the drift, without the mirror ever answering a real client:

```
gregale mirror create <slug> --source <deployment> --mirror <deployment> --percent 25
gregale mirror summary <slug> <mirror-id>
```

The summary reports mirrored request counts, status/schema/body differences, mean and p99 latency deltas, and crashes over the window. Request bodies are only copied if you opt in with `--include-body`, and headers you name in `redact_headers` are stripped — `authorization`, `cookie` and `set-cookie` are always stripped regardless. In the console: **Traffic mirrors** on the Deployments tab.

## Retrying a failed deploy from its stage

A deployment moves through fetch → build → scan → snapshot → release. When one fails, you can retry from the stage that broke rather than from zero:

```
gregale deploys retry <id> --from-stage build
```

In the console: the deployment drawer shows the pipeline; a failed deployment gets a retry control with a stage picker.

## Also on the release path

- **Preview environments** get a URL per pull request and are torn down with `gregale preview destroy` or the console's danger zone on a preview app — see [Preview environments](/docs/preview-environments).
- **Deploy annotations** — `--reason`, `--tag`, `--deployed-by`, `--pr-number` — travel with the deployment and show in its drawer, so the Tuesday-night deploy explains itself.
