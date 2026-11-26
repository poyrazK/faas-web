**To keep a vulnerable or unsigned image out of production, put the check in
the deploy itself, not in one CI step: the platform should refuse a release
unless the scan of that exact image is fresh, complete and clean, and its
signature comes from a publisher you trust.** On Gregale,
`gregale app my-api security --security-policy=enforce` does this for one
app. Its deploys are rejected while the app has high-severity configuration
findings, such as anonymous access or credentialed wildcard CORS. An image
is promoted only with a fresh, complete scan of that exact image and no high,
critical or unknown-severity findings, or the deployment fails before it is
snapshotted; an OCI image also needs a trusted signature. Deploy scans are in
beta, on every plan.

## Why a scan in CI is not enough

A scanner step in CI blocks only the pipelines that run it. A deploy from a
laptop, a hotfix script or an AI coding agent holding a deploy token goes
around it. And a scan describes one image: if the tag that gets deployed
points at a different digest than the one scanned, the result says nothing
about what is running.

Gregale ties the evidence to the deployment. The scan's recorded image
reference has to match the image being promoted, so the artifact that was
scanned is the artifact that serves. Because the check runs inside the
deploy, it applies however the deploy was started.

## Three policies

| Policy          | What it does                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| `off` (default) | Reports findings without affecting deploys                                                                         |
| `warn`          | Keeps deploys flowing while making the policy explicit, for a staged rollout                                       |
| `enforce`       | Rejects new deploys while high-severity findings remain, and gates image promotion on scan evidence and signatures |

Changing the policy is an administrator action behind MFA.

## Turn it on without breaking deploys

```bash
gregale app my-api security --posture                    # read the report, e.g. in CI
gregale app my-api security --security-policy=warn
gregale app my-api security --security-policy=enforce
```

1. **Read the report.** Every app has a read-only security posture report at
   `GET /v1/apps/{slug}/security`; `--posture` prints it. Run it in CI
   before you turn enforcement on.
2. **Fix what it finds.** Configuration findings cover settings such as
   anonymous access and CORS. Findings about the images that are live right
   now use `image_scan_*` codes and flag scan evidence that is missing,
   incomplete, stale or blocking. They stay visible while you deploy a
   replacement, so a clean image can be admitted to take over from the one
   that is serving.
3. **Warn, then enforce.**

## What `enforce` checks at deploy time

- **Configuration.** No high-severity findings, such as anonymous access or
  credentialed wildcard CORS.
- **Scan evidence.** A fresh, complete scan whose recorded image reference
  matches the deployment. A failed, incomplete or unmatched scan, or one with
  any high, critical or unknown-severity finding, fails the deployment before
  snapshotting.
- **Provenance.** OCI images need a trusted signature, so even a clean image
  cannot be promoted when nobody can say who published it.

None of this replaces patching your dependencies or reviewing your code. It
makes sure that what you decided not to ship does not ship anyway.

## After the deploy: quarantine

Evidence can go bad after a release is live. When it regresses, for example
because a trusted publisher was removed or its key no longer validates the
live image, Gregale parks the enforce-mode app and quarantines the deployment
instead of grandfathering it. A quarantined deployment does not boot from any
source: public traffic, service-to-service calls,
crons, warm pools and app tasks are refused with `security_posture_blocked`.

To recover, deploy a newer image and call
`POST /v1/apps/{slug}/security/recover` with that deployment's ID. Traffic
comes back only when every live canary has fresh, complete, digest-matched
scan evidence with no high, critical or unknown findings. Recovery needs
deploy-write scope and MFA, and it is audited. From then on, a lightweight
sweep checks the live deployment between full rescans and parks the app again
if the evidence expires, the image digest changes or a blocking finding
appears.

That is a trade: an enforce-mode app stops serving rather than run an image
whose evidence no longer holds. Keep `warn` on apps where availability has to
win.

## On every app: abuse tooling

Whatever the policy, every image build is scanned for abuse tooling before it
runs. An image that carries a cryptocurrency miner, a mass port scanner or a
flood tool fails to deploy with `image_abuse_detected`, and the error names
the rule and the file. Mining pool addresses and proxy or tunnel servers are
recorded for review but do not block the deploy.

## How other platforms handle it

| Platform                                   | Where the gate runs                                                                                                         | How vulnerabilities block a release                                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Gregale**                                | In the deploy, per app, with `--security-policy=enforce`                                                                    | Built in: a fresh scan matched to the deployed image; high, critical or unknown findings fail it; OCI images need a trusted signature |
| Google Cloud Run with Binary Authorization | At deploy: a noncompliant revision fails and the service keeps its last healthy revision; a logged breakglass can bypass it | Through attestations you create, for example from Artifact Analysis vulnerability results in your build pipeline                      |
| A scanner step in CI                       | In the pipelines that run it                                                                                                | Whatever the step checks; a deploy that skips the pipeline skips the check                                                            |

Sources, checked 2026-11-27:
[Binary Authorization for Cloud Run](https://docs.cloud.google.com/binary-authorization/docs/run/enabling-binauthz-cloud-run),
[Binary Authorization overview](https://docs.cloud.google.com/binary-authorization/docs/overview).

## Pricing

Deploy scans are in beta, on every plan, and the abuse tooling scan runs on
every build. See [Gregale pricing](/pricing), [Security](/docs/security) and
[A microVM for every app](/articles/microvm-isolation) for what isolates the
app once it runs.
