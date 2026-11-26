**`gregale dev` gives you an isolated remote development environment backed by the exact same build, routing, PostgreSQL, and Firecracker infrastructure as production — without needing Docker Desktop, Firecracker, or local KVM on your laptop.** Your local changes sync cleanly with framework hot reload while running inside production-faithful Linux/amd64 microVMs.

## Why local Docker lags behind cloud environments

- **Mac & Windows laptops vs. Linux production:** Apple Silicon laptops emulate `linux/amd64` slowly under Docker Desktop and cannot run Firecracker KVM locally. `gregale dev` offloads the build and microVM runtime to Gregale so platform quirks surface during development, not after merging to `main`.
- **Same network & database shape:** Test real HTTPS URLs, OAuth redirect callbacks, outbound webhooks, and managed PostgreSQL (`gregale dev --postgres`) against the same routing edge your production apps use.
- **Zero manual cleanup:** Every developer environment has an automatic lease that renews while syncing or watching (`24h` default; configurable up to `24h` Free, `72h` Hobby, `168h` Pro, `336h` Scale) and expires automatically when you stop working.

## Start a remote dev loop in one command

```sh
cd my-api
gregale dev
```

For supported Node.js and Python apps, `gregale dev` starts the framework development server with hot reload automatically. Pass `--watch=false` whenever you want to verify a production-shaped build, or `--postgres` (Hobby and above) to wire a managed PostgreSQL database directly into your dev session.

| Plan      | Separate developer apps | Max dev lease | Managed Postgres in dev |
| --------- | ----------------------: | ------------: | ----------------------- |
| **Free**  |                       1 |           24h | —                       |
| **Hobby** |                       2 |           72h | Yes (`--postgres`)      |
| **Pro**   |                       5 |          168h | Yes (`--postgres`)      |
| **Scale** |                      10 |          336h | Yes (`--postgres`)      |

Developer environments have their own app allowance separate from your production apps and PR preview environments, so spinning up isolated sessions never competes with production app slots. Run `gregale dev info` to inspect an active session or `gregale dev --stop` when finished.

## Sources

- [Remote dev environments (`gregale dev`)](/docs/dev)
- [Plans and limits](/docs/plans)
- [PR preview environments](/docs/preview-environments)
