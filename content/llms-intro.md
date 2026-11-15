# Gregale

> Gregale is a serverless platform for stateless HTTP apps, APIs, functions and background work. Instances run in Firecracker microVMs. Idle request apps can park with zero resident RAM and wake from a snapshot when traffic returns. Deploy from source or a compatible Linux/amd64 OCI image.

Gregale is CLI-first (`gregale deploy`), with a web console for deployment,
observability and resource management. Some operations require the CLI or API.
{{BETA_STATUS}}

Key facts:

- Isolation: every instance is a Firecracker microVM, not a container in a
  shared kernel. Snapshot wakes use a restored VM ({{RESTORE_TARGET}}).
  {{RESTORE_CONTEXT}}
- Scale to zero: parked request instances hold zero RAM; frozen instances
  retain RAM but are not billed. Background workloads have their own lifecycle.
- Function runtimes include Node 22 and 24, Python 3.12 and 3.13, and Go 1.24 (beta).
  Container apps support stateless Linux/amd64 HTTP images listening on
  `0.0.0.0:$PORT`. Their filesystem is ephemeral; use a database or object
  storage for durable state. Privileged containers and host mounts are unsupported.
- Build from source: push a repo or tarball; buildpacks (Railpack) or your
  Dockerfile, built inside an isolated builder microVM.
- Included: cron jobs, delayed tasks, edge rules, custom domains, per-PR
  preview environments, sealed secrets, egress lockdown (deny-by-default
  outbound) and structured logs. Queues and request tracing are in preview.
- Projects: a Compose file or a monorepo deploys as one project whose
  services call each other by name. Kubernetes manifests import in preview.
- Privacy: GDPR export and deletion are built into the product.
- Pricing: metered GB-hours with a plan allowance and a spend cap you set in
  the console. Paid plans open after the beta.
