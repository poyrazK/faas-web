# Deploy your first app

Use the guided Gregale CLI to deploy your own project or a small starter, then
verify a response from your application. The [quickstart](/docs/quickstart) is
the reference for this flow, recovery, and automation.

## Install and start

```bash
curl -fsSL https://get.gregale.dev | sh
gregale start ./my-api
```

Point Start at your project directory. It signs you in when needed, detects your
app, and shows the source, account, access settings, and resources before you
confirm deployment. Your current working files, including uncommitted changes,
are included. Review the proposed files and secret key names before confirming.

No project yet? Run Start in an empty directory and choose a Node.js, Python,
or Go starter:

```bash
mkdir my-first-api
cd my-first-api
gregale start
```

You do not need Node.js or npm to install the CLI. A starter's local development
tools depend on the language you choose. The [installation guide](/docs/install)
covers other installation channels and PATH troubleshooting.

Prefer the browser? [Start in the dashboard](/onboarding) with a sample or a GitHub
repository. Both routes lead to deployment progress and response verification.
Deployments use your account's app and compute allowance; review the displayed
limits before confirming.

## Verify your application

Deployment readiness, an application response, and public access are separate
results. Start automatically checks an application route against the accepted
deployment. In the dashboard, choose **Verify response** after **Deployment ready**.
Only a 2xx application response is verified. Opening a link alone does not verify it.

Private and internal apps can be tested using your Gregale account on every plan,
without changing their access settings. To repeat a check from the terminal,
use the exact deployment UUID printed in your launch receipt:

```bash
gregale release verify DEPLOYMENT_UUID --app my-api --path /
```

The result names the deployment, environment, and actual HTTP status. This
owner-authorized check keeps account credentials out of the app request and
does not verify public access. Application-owned authentication still applies.

A private endpoint can return 401 in a browser without the required credentials,
even when deployment succeeded. If you intentionally make your app public,
test an application route on its public URL separately. A public `/healthz`
can be answered by Gregale's edge without running your code.

## Change it or recover

After verification, Start offers an edit-and-deploy loop. Change your code,
review the update, and confirm it to see the new response. A starter can offer
a greeting change directly.

If you are interrupted, repeat `gregale start` with the same source directory
and choose **Continue**. This inspects the saved submission before starting
another deployment. For a failed check, retry the response check or inspect logs:

```bash
gregale logs my-api --follow
gregale inspect my-api --errors
```

Continue with the [quickstart](/docs/quickstart), [daily development](/docs/dev),
or [coding-agent guide](/docs/agents). Agents and CI use non-interactive
`deploy` and `release verify`; Start requires a terminal.
