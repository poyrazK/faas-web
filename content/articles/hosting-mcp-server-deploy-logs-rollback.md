**Three hosting platforms ship an official MCP server whose tools cover all
three jobs: Gregale, Vercel and Dokploy.** An AI agent connected to one of
them can deploy, read the app's logs and roll back to an earlier release
through MCP tools alone. Render, Railway, DigitalOcean App Platform, Heroku,
Google Cloud Run and Netlify have MCP servers that deploy but have no
rollback tool. Fly.io's hosted server manages Machines, volumes and secrets
but has no deploy or app-log tool, and Cloudflare's reaches its whole API
through code the agent writes rather than through named tools.

Checked against each vendor's MCP documentation and published server source
on November 26, 2026. Tool names are the vendors' own.

## What each platform's MCP server can do

| Platform                      | Server                                            | Deploy                                                                   | Read logs                                                        | Roll back                                                 |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------- |
| **Gregale**                   | Hosted at `https://api.gregale.dev/mcp` (preview) | `gregale_plan_upload_deploy` or `gregale_plan_source_deploy`, then apply | `gregale_get_logs`                                               | `gregale_plan_rollback`, then `gregale_apply_rollback`    |
| **Vercel**                    | Hosted at `https://mcp.vercel.com`                | `create_deployment`, `deploy_to_vercel`                                  | `get_runtime_logs`, `get_deployment_build_logs`                  | `request_rollback`                                        |
| **Dokploy**                   | Runs beside your own Dokploy instance             | `application-deploy`                                                     | `application-readLogs`                                           | `rollback-rollback`, once registry-based rollbacks are on |
| **Render**                    | Hosted at `https://mcp.render.com/mcp`            | `trigger_deploy`                                                         | `list_logs`                                                      | No tool                                                   |
| **Railway**                   | Hosted at `https://mcp.railway.com`               | `redeploy`, `accept-deploy`                                              | Through the `railway-agent` tool; `get_logs` on the local server | No tool                                                   |
| **DigitalOcean App Platform** | Hosted at `https://apps.mcp.digitalocean.com/mcp` | `apps-create-app-from-spec`, `apps-update`                               | `apps-get-logs`                                                  | No tool                                                   |
| **Heroku**                    | Runs locally (`@heroku/mcp-server`)               | `deploy_to_heroku`                                                       | `get_app_logs`                                                   | No tool                                                   |
| **Google Cloud Run**          | Hosted at `https://run.googleapis.com/mcp`        | `deploy_service_from_image`, `_from_archive`, `_from_file_contents`      | Google's separate Cloud Logging MCP server                       | No tool                                                   |
| **Netlify**                   | `@netlify/mcp`                                    | `netlify-deploy-site`                                                    | Edge request analytics only                                      | No tool                                                   |
| **Fly.io**                    | Hosted at `https://mcp.fly.io`                    | No deploy tool; `create_machine` starts a Machine from a configuration   | Machine events only                                              | No tool                                                   |
| **Cloudflare**                | Hosted at `https://mcp.cloudflare.com/mcp`        | Through API code the agent writes                                        | The separate Workers Observability server                        | Through API code the agent writes                         |

"No tool" means the MCP server has none. Each of those platforms can still
roll back from its dashboard, CLI or API, so an agent that needs to roll
back falls back to the CLI, or asks you.

## What else to check before you give an agent write access

Deploy, logs and rollback are the minimum. These decide what happens when the
agent gets it wrong:

- **Who approves a production change.** Connecting Vercel's server gives the
  agent the same access as your Vercel account, and Vercel's docs ask you to
  turn on human confirmation in your MCP client. Railway marks destructive
  tools so that clients which respect the hints ask first. Fly.io's server
  grants access per organization, app and operation, and its Claude Code
  plugin adds a confirmation hook. On Gregale the check is in the platform:
  by default, an agent's production deploy or rollback returns a review
  link, and it goes through only after a person approves it in a signed-in
  session. A client set to approve every tool call can't skip it.
- **What reaches users first.** On Gregale, a deploy to an app that is
  already serving is staged at 0% of traffic until the agent promotes it
  with `gregale_promote_deployment`.
- **What a rollback covers.** Every rollback tool above puts back an earlier
  release. A database migration that ran with the bad release stays; see
  [Roll back a bad migration](/articles/rollback-code-and-database).
- **Everything else the agent changed.** Gregale's server lists the agent's
  own changes, such as settings, scaling, variables and the resources it
  created, with what undoing each would do (`gregale_plan_undo`), and undoes
  them once you approve (`gregale_apply_undo`).
- **What the platform is for.** Vercel's server fits frontend and Next.js
  projects. Dokploy suits teams that run their own servers. Gregale is built
  for backend APIs, workers, crons and MCP servers.

## Connect Gregale's MCP server

In Claude Code:

```sh
claude mcp add --transport http gregale https://api.gregale.dev/mcp
```

ChatGPT and claude.ai add the same URL as a connector. When you connect,
choose "Deploy and manage apps" so the agent can deploy, promote and roll
back, or "Inspect only" to let it read apps, deployments and logs. An agent
with nobody at a browser, such as one in CI, uses an agent key instead:

```sh
gregale key create ci-agent --scopes agent,deploy:write
```

## Sources

[Vercel MCP tools](https://vercel.com/docs/agent-resources/vercel-mcp/tools),
[Dokploy MCP tools](https://github.com/Dokploy/mcp/blob/main/TOOLS.md),
[Dokploy rollbacks](https://docs.dokploy.com/docs/core/applications/rollbacks),
[Render MCP server](https://render.com/docs/mcp-server),
[Railway MCP server](https://docs.railway.com/reference/mcp-server),
[DigitalOcean MCP server](https://github.com/digitalocean-labs/mcp-digitalocean),
[Heroku MCP server](https://github.com/heroku/heroku-mcp-server),
[Cloud Run remote MCP server](https://docs.cloud.google.com/run/docs/use-cloud-run-mcp),
[Netlify MCP server](https://github.com/netlify/netlify-mcp),
[Fly MCP guide](https://mcp.fly.io/),
[Cloudflare MCP server](https://github.com/cloudflare/mcp).

## Related

- [Human approval before an AI agent changes production](/articles/ai-agent-production-approval)
- [Undo what an AI agent changed in production](/articles/undo-ai-agent-changes)
- [Best cloud platform for AI coding agents in 2026](/articles/best-cloud-for-ai-coding-agents)
- Reference: [Connect an agent to Gregale](/docs/agents#connect-an-agent-to-gregale)
