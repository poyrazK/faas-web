# Deploy your first app

Start with a small Node.js API, deploy it from your terminal, and verify the live URL. You can use your own repository afterward.

> Hosting is in public beta. Start with a demo, side project, or another non-critical workload. Deployments consume your account’s compute and app allowance; check your [plan limits](/docs/plans) first.

## Before you start

- Create a [Gregale account](/signup), or sign in to your existing account.
- Have a terminal with Node.js and npm installed.
- Make sure your plan has room for another deployed app.

## Install and sign in

Install the CLI, then authenticate this machine:

```bash
npm install -g gregale
gregale login
```

Follow the login prompts. Keep credentials out of your repository and shared terminal output. For automation, use a scoped token rather than sharing your personal login.

## Create a small API

Generate the built-in Node.js starter in a new directory:

```bash
gregale init --template hello-node --path my-first-api
cd my-first-api
```

Review the generated files before deploying. To explore other starters, run `gregale init --list`.

## Deploy the directory

Choose an available app name and deploy the files you just generated:

```bash
gregale deploy --path . --worktree --name my-first-api
```

Replace `my-first-api` with your chosen app name. `--worktree` explicitly includes the current files, including uncommitted and untracked files. Review them for secrets before deploying.

The CLI waits for the build, readiness checks, and a platform-side smoke request. A queued build is not the same as a live app. Wait for the successful deployment receipt and its app URL.

## Verify the live app

Open the URL printed by the CLI in your browser. Confirm that the starter responds, then inspect the app:

```bash
gregale inspect my-first-api
```

You can also open the [console](/dashboard) to inspect the deployment and runtime logs. With scale-to-zero enabled, an eligible idle app can park; the next request waits for it to wake.

## If the deployment fails

Inspect the latest failed deployment rather than repeatedly deploying unchanged code:

```bash
gregale inspect my-first-api --errors
```

| Symptom | Next step |
|---|---|
| Authentication failed | Run `gregale login` again and confirm the account. |
| App or resource limit reached | Review your [plan limits](/docs/plans) and existing apps. |
| Build failed | Read the build error and check dependencies, source files, and runtime selection. |
| Readiness failed | Check the app’s startup command, listening port, and health route. |
| Changes are missing | Confirm the selected directory. Git-based deploys can use committed source; `--worktree` explicitly deploys current files. |

## Use your own project

- [Deploy from a checkout or connect GitHub](/docs/deploy-from-github).
- [Pin a GitHub source ref for CI](/docs/deploy-from-source).
- [Attach a custom domain](/docs/custom-domains).
- [Understand scale-to-zero](/docs/scale-to-zero).

When you finish experimenting, remove the demo app in the console if you no longer need it. This guide does not enable preview jobs, workflows, or object storage.
