# Deploy your first app

Run `gregale start` to launch your own project or a small starter API. The guided session handles login, source checks, deployment, and the first response check.

> Hosting is in public beta. Start with a demo, side project, or another non-critical workload. Deployments consume your account’s compute and app allowance; check your [plan limits](/docs/plans) first.

## Before you start

- Create a [Gregale account](/signup), or sign in to your existing account.
- Have a terminal available.
- Make sure your plan has room for another deployed app.

## Install the CLI

Install the CLI:

```bash
curl -fsSL https://get.gregale.dev | sh
```

If you already use npm, `npm install -g gregale` is also available. Start opens browser login when needed. For automation, use `gregale deploy` with a scoped token.

## Start a guided launch

From your project directory, run:

```bash
gregale start
```

Choose **Deploy this directory**, **Create a starter**, or **Choose another directory**. If you have no project ready, the starter option creates a local Node.js, Python, or Go HTTP app for you to edit.

Review the source, account, app name, environment, access settings, and allowance before confirming. Start includes your working files, including uncommitted changes, with the normal source exclusions and secret scan. If an app with the inferred name already exists, choose whether to update it or create an app with another name.

If you have used `gregale link`, Start reads the nearest link for the source you select and verifies its project, app, and environment. A linked project with several workloads and no default app offers a workload picker. Choosing a workload for one launch keeps your linked defaults. An unlinked source uses the `default` environment, including when you select it from another linked directory.

## Configure required keys

Start checks required runtime key names against the selected app's configuration in the reviewed environment and any secrets file you select. Existing metadata confirms key presence; it does not verify values or application behavior.

A local `.env` alone does not configure the deployed app. If Start reports missing keys, choose a `KEY=VALUE` secrets file, which can be your `.env`, and review the key names before deployment. Selected values are sealed before source upload; the selected file is excluded from source and its values are omitted from session metadata.

## Check the live response

Start follows build progress and readiness, then tests the app. For a public app it shows the exact URL that answered, the HTTP status, a response preview, and elapsed time. Private apps use an owner-authorized check of the accepted deployment and environment, with the actual HTTP status and a bounded response preview. Account credentials stay on the control plane.

In a named environment, public checks require the accepted deployment's live URL. Updates also require evidence identifying the accepted deployment. When a successful public response omits that identity, Start follows it with an owner-authorized check and labels the result separately from public URL verification.

Owner-authorized checks can wake that exact deployment through normal scheduler admission. They do not follow redirects or bypass application-owned authentication: a GET returning 401 or 403 still needs attention. These checks do not establish public ingress or customer access. They require server support for deployment response checks; older servers fail visibly without testing a default-environment deployment instead.

If the request fails, retry the check, view recent logs, or choose another app-relative GET path. These checks use the accepted deployment without submitting another one. A redirecting or authenticated root route may need a different health path. If `/healthz` is answered by the gateway, choose a route served by your app, such as `/`; a gateway health answer cannot verify an application response.

Built-in starters offer an optional greeting change. Enter your greeting, review the edit and new deployment, and see the changed response live. Press Enter to finish without editing.

For your own project, choose **I've made changes — review and deploy again** after editing in another terminal or editor. Start reviews added, modified, and deleted file names, refreshes configuration checks, and asks you to confirm an update to the same app and environment. It then checks the new deployment. You can repeat this loop or choose **Finish**, which is the default. Closing or declining before confirmation submits no update. When you resume a session, the review lists current files because the earlier source comparison is unavailable.

If an update fails or is interrupted, its accepted deployment ID and the previous successful check's deployment ID remain recorded for recovery. The session shows an inspection command for the earlier deployment. Continuing reconnects to the accepted update without submitting another one.

The session prints commands for deploying changes and following the accepted deployment's logs. Follow-up commands preserve the reviewed environment; named environments show the tested URL or a deployment inspection command. You can also use the [console](/dashboard) to inspect deployments and runtime logs. Eligible idle apps park; the next request waits for them to wake. Check `gregale usage` for your account's recorded usage.

## Continue an interrupted or failed launch

Run `gregale start` again from the same original directory and choose **Continue** to reconnect to an accepted deployment:

```bash
gregale start
```

| Symptom | Next step |
|---|---|
| Authentication failed | Follow Start's browser login or run `gregale login` and confirm the account. |
| Required keys are missing | Select a secrets file or configure the existing app, then recheck. |
| App or resource limit reached | Review your [plan limits](/docs/plans) and existing apps. |
| Build failed | Read the build error and check dependencies, source files, and runtime selection. |
| Readiness failed | Check the app’s startup command, listening port, and health route. |
| Changes are missing | Confirm the selected directory. Git-based deploys can use committed source; `--worktree` explicitly deploys current files. |

Switching to another account, API, or linked target offers a separate launch while preserving the original recovery record. Switch back to continue the earlier launch. Changing a source link after review stops submission; restore the saved target's link before retrying that deployment.

## Use your own project

- [Deploy from a checkout or connect GitHub](/docs/deploy-from-github).
- [Pin a GitHub source ref for CI](/docs/deploy-from-source).
- [Attach a custom domain](/docs/custom-domains).
- [Understand scale-to-zero](/docs/scale-to-zero).

When you finish experimenting, remove the demo app in the console if you no longer need it. This guide does not enable preview jobs, workflows, or object storage.
