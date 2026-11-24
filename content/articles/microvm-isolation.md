**Gregale runs every app instance in its own Firecracker microVM.** Each one
has its own Linux kernel, its own network, its own memory limit and its own
jailed process on the host, so one app can't read another's memory, exhaust
its resources, or reach it through a shared kernel. Firecracker is the
open-source virtual machine monitor AWS built to run Lambda and Fargate. On
Gregale you get that isolation by default, for every API, worker, job and MCP
server, without managing VMs: deploy a Dockerfile or a source repo with
`gregale deploy`.

## What each app gets

| Boundary     | What Gregale does                                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kernel       | Every instance boots its own guest Linux kernel inside a Firecracker microVM. Apps never share a host kernel with each other.                                              |
| Host process | Each microVM is started by Firecracker's jailer under a unique user and group ID, inside a chroot, with a default-deny seccomp filter.                                     |
| Memory       | Each microVM runs in its own cgroups v2 scope, capped at your plan's RAM plus 8 MB. One app can't take memory from another.                                                |
| Network      | Each instance gets its own network namespace. Outbound mail ports (25, 465, 587), private address ranges, link-local and cloud metadata addresses are blocked.             |
| Files        | No host directories are shared with guests. Only block devices cross the boundary: a read-only base image and your app's own layer.                                        |
| Randomness   | A virtual hardware random number generator is attached to every guest, and the kernel is reseeded every time an instance wakes, so two instances never share random state. |
| Secrets      | Environment secrets are sealed at rest, so plaintext values are never stored in the database.                                                                              |
| Builds       | Each build runs in its own short-lived microVM (2 vCPU, 2048 MB), so `npm install` or `pip install` of a fresh dependency never runs on a shared host.                     |

These controls are listed in Gregale's [Data Processing Agreement](/docs/dpa)
as its technical and organisational measures under GDPR Art. 32. See also
[Security](/docs/security) and [Compliance](/docs/compliance).

## Why a VM per app matters

- **A bad deploy stays in its own box.** A memory leak, a fork bomb or a
  runaway process hits its own VM's limits, not your other services.
- **A kernel bug isn't a way out.** Containers on one host share that host's
  kernel, so a kernel exploit in one container can reach the others. A
  microVM puts a separate kernel and a hardware virtualization boundary in
  between.
- **Safer for code you didn't write.** AI agents running tools, customer
  scripts, plugins and fresh dependencies all run behind the same boundary as
  the rest of your backend.
- **Easier security reviews.** "Every tenant workload runs in its own
  Firecracker microVM, jailed, with egress filtering" answers a common
  question in customer security questionnaires.

## Your Dockerfile works as is

You don't write VM configuration. Gregale takes a Dockerfile, an OCI image or
a source repo and runs it in a microVM. What it needs: Linux/amd64, an HTTP
server listening on `0.0.0.0`, and a process that honours `PORT` (default
`8080`). Docker settings that only make sense on a shared host, such as
`privileged`, `cap_add` and `devices`, are ignored with a warning, because
each service already has its own machine. The root filesystem is ephemeral;
keep durable state in managed Postgres or object storage. See
[Container compatibility](/docs/container-compatibility).

```bash
gregale deploy            # from a directory with a Dockerfile or source code
```

A VM per app doesn't mean slow starts: an idle app wakes from a memory
snapshot of its running process. The measurements are in
[Firecracker snapshot restore on SSD](/research/firecracker-snapshot-restore-ssd-2026-09-09).

## How other platforms isolate apps

| Platform                 | What each app runs in                                              | Notes                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Gregale**              | Firecracker microVM per app instance, by default                   | Managed backend platform: APIs, workers, jobs, workflows, cron, MCP servers, Postgres, object storage, safe releases                      |
| **Fly.io**               | Firecracker microVM per Machine                                    | Lower-level: you choose and manage Machines, regions and volumes                                                                          |
| **AWS Lambda / Fargate** | Firecracker microVMs                                               | You assemble the rest from AWS services (API Gateway, IAM, queues, CodeDeploy)                                                            |
| **Google Cloud Run**     | 2nd gen: microVM with a full Linux kernel; 1st gen: gVisor sandbox | Jobs and worker pools use 2nd gen only                                                                                                    |
| **Heroku**               | Containers (dynos)                                                 | Platform in sustaining engineering since February 2026                                                                                    |
| **Render**               | Containers                                                         | Render's own writing describes services as containers, not built for untrusted user code; a separate sandboxes product is in early access |
| **Railway**              | Containers                                                         | No per-service VM isolation documented; Railway Sandboxes (beta) are VMs                                                                  |

Checked against each vendor's public documentation on November 24, 2026:
[Firecracker](https://firecracker-microvm.github.io/),
[Fly Machines](https://fly.io/docs/machines/),
[Cloud Run execution environments](https://docs.cloud.google.com/run/docs/about-execution-environments),
[Heroku dynos](https://devcenter.heroku.com/articles/dynos),
[Render on sandboxes](https://render.com/articles/what-are-sandboxes-and-why-your-agents-should-use-them),
[Railway Sandboxes](https://docs.railway.com/sandboxes).

## Pricing

MicroVM isolation is how every Gregale app runs, on every plan, including
Free; there is no isolation add-on. See [Gregale pricing](/pricing).
