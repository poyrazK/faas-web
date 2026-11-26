**Host a Go HTTP API or Go MCP server on scale-to-zero Firecracker microVMs that
auto-build from `go.mod`, produce a small compiled binary well under Free's 256 MB
limit, and pause billing ~1 second after each request.** On Gregale, Go
services (`net/http`, Gin, Chi, or Streamable HTTP MCP handlers) need no
Dockerfile for module-root builds, run behind a pre-wake OWASP WAF, and attach
managed PostgreSQL as `DATABASE_URL` on Hobby ($10 a month).

## How Go deploys without Dockerfile boilerplate

When Gregale sees `go.mod` at your repository root, the builder matches the Go
release in your `go` directive and compiles the module cleanly to `./out`:

- **Small static binary footprint.** A compiled Go server fits effortlessly inside
  Gregale Free's 256 MB app-layer limit (1 app, 20 GB-RAM-hours a month at $0)
  and wakes quickly from memory snapshots between requests.
- **No `Procfile` binary mismatch.** Heroku-style `Procfile` entries like
  `web: my-app` point to binaries another buildpack names; on Gregale, set
  `hosting: start: ./out` in `gregale.yaml` or omit `Procfile` so Gregale runs
  `./out` automatically. Multi-binary layouts under `cmd/server` can specify a
  `Dockerfile` or `gregale.yaml`.
- **Safe defaults built in.** Every production deploy stages across
  1% → 10% → 50% → 100% live traffic with automatic 5xx rollback (beta), free
  per-PR preview environments, and optional `gregale add postgres`.

## Minimal Go service and one-click MCP starter

```go
package main

import (
	"log"
	"net/http"
	"os"
)

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("ok"))
	})
	mux.HandleFunc("GET /", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte("hello"))
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
```

Deploy a Go HTTP API or try the public Go remote MCP server template in one click:

- [Deploy mcp-server-go on Gregale](/deploy?repo=https://github.com/gregale-dev/mcp-server-go)
- CLI commands from your module root:

```bash
gregale deploy --dry-run
gregale deploy --name go-api
gregale add postgres --app go-api
```

## How Go hosting options compare

| Platform             | Source build without Dockerfile | Free backend tier                | Idle billing behavior         | Releases & Postgres recovery                |
| -------------------- | ------------------------------- | -------------------------------- | ----------------------------- | ------------------------------------------- |
| **Gregale**          | Yes (`go.mod` → `./out`)        | Free: 1 app, 256 MB, 20 GB-hours | Pauses ~1s after last request | Default 5xx canary rollback + DB PITR       |
| **Fly.io**           | Builder / Dockerfile            | $5/mo allowance (up to 3 VMs)    | Auto-stop/start on requests   | Image redeploy + manual PG cluster restore  |
| **Google Cloud Run** | Buildpacks / Dockerfile         | 180k vCPU-s, 360k GiB-s/month    | Scales to zero per request    | Manual revisions + separate Cloud SQL       |
| **Render**           | Native Go runtime               | 750 hrs (spins down 15m idle)    | Paid services bill 24/7       | Manual deploy rollback + DB restore         |
| **Railway**          | Railpack                        | $1 monthly usage credit          | Serverless sleeps when idle   | Manual deploy rollback + sibling DB restore |

Stay on **Fly.io** or **Google Cloud Run** if you need multi-region edge
placement or tight GCP VPC/IAM coupling. Choose **Gregale** when you want Go
services running in Firecracker microVMs that pause billing ~1 second after idle,
bundled PostgreSQL in a $10 Hobby plan, free PR previews, and automatic 5xx
canary rollbacks. See [Deploy a Go app](/docs/deploy-go),
[Host an MCP server](/docs/mcp-hosting), and
[starter templates](/templates).
