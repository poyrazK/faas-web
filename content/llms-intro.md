# Gregale

> Gregale is a serverless platform for APIs, functions and background work. Every app runs in its own Firecracker microVM, scales to zero when idle — holding no memory at all — and wakes from a VM snapshot when a request arrives. Deploy with one CLI command from source or any OCI image.

Gregale is CLI-first (`gregale deploy`), with a full web console for
everything the API can do. {{BETA_STATUS}}

Key facts:

- Isolation: every instance is a Firecracker microVM, not a container in a
  shared kernel. A wake is a snapshot restore ({{RESTORE_TARGET}}).
  {{RESTORE_CONTEXT}}
- Scale to zero: idle apps are parked and hold zero RAM; you pay only for
  GB-hours actually resident. Billing is metered per app.
- Runtimes: Node 22 and 24, Python 3.12 and 3.13, Go 1.24 (beta) — or bring
  any OCI image.
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
