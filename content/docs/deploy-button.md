# Deploy on Gregale button

Add a one-click **Deploy on Gregale** badge to any public GitHub repository README so developers can launch your starter, API, worker, or remote MCP server on Gregale without copying URLs manually.

## How `/deploy` works

When someone clicks your badge at `https://gregale.dev/deploy?repo=...`:

- **Signed-in users** are redirected straight to the new-app flow (`/dashboard/apps/new?source=git&repo=<owner/repo>`) with the repository and optional ref prefilled. If onboarding is not complete yet, Gregale saves the repository target through `/onboarding` first and returns to deploy once setup finishes.
- **Signed-out visitors** see the repository summary (or full starter card for official [Gregale templates](/templates)), sign-up and sign-in buttons that carry the deploy target through `?next=`, a preflight [repository compatibility check](/will-it-run), and a copyable `gregale deploy --repo ...` command.

## Add a badge to your README

Replace `OWNER/REPO` with your GitHub owner and repository name (for example `gregale-dev/nextjs-postgres-starter`):

### Markdown

```markdown
[![Deploy on Gregale](https://gregale.dev/deploy-badge.svg)](https://gregale.dev/deploy?repo=https://github.com/OWNER/REPO)
```

### HTML

```html
<a href="https://gregale.dev/deploy?repo=https://github.com/OWNER/REPO">
  <img
    src="https://gregale.dev/deploy-badge.svg"
    alt="Deploy on Gregale"
    width="168"
    height="32"
  />
</a>
```

The SVG badge at `https://gregale.dev/deploy-badge.svg` renders at `168x32` with no third-party tracker scripts.

## Query parameters

| Parameter | Required | Accepted values | Notes |
| --- | --- | --- | --- |
| `repo` | Yes | `https://github.com/owner/repo`, `https://github.com/owner/repo.git`, `github.com/owner/repo`, or `owner/repo` | Validated and normalized to `owner/repo`. Nested tree paths and non-GitHub hosts are rejected and prompt for a valid repository URL on `/deploy`. |
| `ref` | No | Branch name, Git tag, or commit SHA (`branch` is accepted as an alias) | Passed to `/dashboard/apps/new` and `/will-it-run` when valid so pinned releases work out of the box. |

Example pinned to a branch or tag:

```text
https://gregale.dev/deploy?repo=https://github.com/OWNER/REPO&ref=v1.0.0
```

## Compatibility and configuration

Gregale builds repositories using [container-compatibility](/docs/container-compatibility) defaults:

- Include a `gregale.toml` if your app declares multiple processes (API + worker), custom build/release commands, or managed Postgres bindings.
- Standard Node, Bun, Python, and Go projects without a `gregale.toml` are detected automatically via Railpack or your `Dockerfile`.
- Test how Gregale detects any public repository before linking it by running it through the [Will it run](/will-it-run) checker.

## Related guides

- [Deploy from your repository](/docs/deploy-from-github) — GitHub integration, continuous deploys, and GitHub Actions.
- [Deploy a GitHub source ref](/docs/deploy-from-source) — pin branches, tags, and commit SHAs in CLI and CI deploys.
- [Starter templates & MCP servers](/templates) — 11 official starters with live Deploy on Gregale buttons.
- [Community Discussions](https://github.com/gregale-dev/community/discussions) — ask questions or share your template.
