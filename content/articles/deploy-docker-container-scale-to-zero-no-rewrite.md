**Deploy any stateless Linux/amd64 Docker container listening on `0.0.0.0:$PORT` at scale-to-zero—without rewriting handlers for AWS Lambda, stripping Dockerfiles, or breaking PRNG state across VM snapshots.** Gregale preserves standard OCI entrypoints, healthchecks, private registries, and Compose workflows inside per-app Firecracker microVMs.

## Why traditional serverless forces rewrites

Function-as-a-Service platforms like AWS Lambda and Cloudflare Workers force you into vendor handler signatures, language-runtime shims, and bundle size ceilings, breaking standard Go binaries, Spring Boot apps, Rust APIs, Nginx proxies, and Docker Compose stacks. Meanwhile, naïve snapshot-restore VMs introduce subtle production bugs—restored processes repeating identical random IDs, TLS nonces, or Gunicorn worker timeouts after sleeping.

## The Gregale OCI container and Docker Compose contract

Run an instant compatibility preflight and deploy immutable digests or Docker Compose projects unchanged:

```sh
gregale deploy check --image registry.example.com/team/api@sha256:<digest>
gregale deploy --image registry.example.com/team/api@sha256:<digest>
```

- **Full OCI metadata honored:** Preserves `ENTRYPOINT`, `CMD`, `ENV`, `WORKDIR`, `USER`, `STOPSIGNAL`, `HEALTHCHECK`, and exposed ports (binding `0.0.0.0:$PORT`, default `8080`, port `80` also supported), plus Compose overrides (`build.args`, `build.target`, BuildKit `build.secrets` up to `16` per build, and runtime `/run/secrets` files up to `16` per service).
- **Private registries supported cleanly:** Store scoped credentials for Docker Hub, Amazon ECR (auto-exchanges read-only IAM keys for 12-hour passwords), Google Artifact Registry, and Azure Container Registry via `gregale registry set --app APP_ID --registry ... --password-stdin`.
- **Automatic platform HTTP health conversion:** Simple `curl` or `wget` `HEALTHCHECK` probes checking the app's serving port automatically promote to native platform HTTP readiness checks so your image needs neither tool installed, while `depends_on: {condition: service_healthy | service_completed_successfully}` coordinates startup order and migrations.

## Built-in snapshot-restore safety

Because scale-to-zero containers resume from process memory snapshots, Gregale solves post-restore randomness and clock-jump hazards out of the box:

- **Kernel and language reseeding:** Automatically reseeds the guest kernel (`/dev/urandom`, `getrandom(2)`), Node.js (`crypto`, TLS state, `Math.random`, npm `uuid`, `nanoid`, `bson`), Python (`random`, `ssl`, `numpy.random`, `bson`), and Java 16+ (`JAVA_TOOL_OPTIONS`, plus `reseed.OnRestore` for Go custom generators).
- **Gunicorn freeze guard:** Prevents Gunicorn masters from killing Python workers when a VM wakes after being parked (`GREGALE_GUNICORN_FREEZE_GUARD`).
- **Startup preflight validation:** Checks executable entrypoint paths before booting VMs, failing fast with `image_manifest_invalid` instead of crash-looping.

## Contract boundaries to plan around

Gregale targets stateless `Linux/amd64` OCI images with ephemeral root filesystems (layers capped at `2,000,000` entries and `2x` ephemeral disk budget): store persistent state in managed PostgreSQL or object storage rather than Docker `VOLUME` mounts, avoid privileged mode or Docker sockets, and place large temporary scratch files under `WORKDIR` or `HOME` since `/tmp` and `/dev/shm` use RAM-backed `tmpfs` (up to half of instance RAM). Full-rootfs images work automatically on paid plans and via explicit opt-in on Free.

See [Container compatibility](/docs/container-compatibility), [Registry credentials](/docs/registry-credentials), [Will it run?](/will-it-run), [Scale to zero without slow cold starts](/articles/scale-to-zero-without-cold-starts), and [A microVM for every app](/articles/microvm-isolation).
