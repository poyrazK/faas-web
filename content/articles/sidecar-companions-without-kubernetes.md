**Run an OpenTelemetry collector, Sentry relay, Datadog DogStatsD agent, or local reverse proxy inside your application's Firecracker microVM without running Kubernetes or ECS.** With `companions:` in `gregale.yaml`, Gregale boots up to four long-running helpers (plus one setup helper) in the same loopback network namespace as your app, with startup probes, shared Unix sockets, and scoped secret delivery.

## Why sidecars usually force teams onto Kubernetes

Most developer-focused PaaS platforms run a single container per service, with no way to attach a local OpenTelemetry collector, Datadog DogStatsD agent, or TLS proxy over `127.0.0.1`. Teams that need sidecar collectors or local ingress proxies often migrate to Kubernetes Pods or AWS ECS task definitions just to colocate two containers.

## Built-in presets and custom digest-pinned companions

Declare managed presets (`opentelemetry`, `sentry`, `datadog-dogstatsd`) or custom immutable `@sha256:...` images directly under `companions:` in `gregale.yaml` (if a preset is not yet enabled on your account, `companion_preset_unavailable` falls back cleanly to a custom digest-pinned image):

```yaml
companions:
  - preset: opentelemetry
    env:
      OTEL_EXPORTER_OTLP_ENDPOINT: https://telemetry.example.com
  - name: database-proxy
    image: registry.example.com/database-proxy@sha256:<64-hex-digest>
    port: 5432
    ram_mb: 128
    env_secrets:
      DATABASE_URL: secret:DATABASE_URL
    startup_probe:
      tcp_socket:
        port: 5432
    depends_on:
      - name: main
        condition: started
```

Each companion gets isolated image storage, CPU, memory, and scratch controls while sharing loopback (`FAAS_WORKLOAD_DATABASE_PROXY_ADDR=127.0.0.1:5432`, `FAAS_WORKLOAD_MAIN_ADDR`) and an in-memory shared folder `/tmp/gregale/companions/<name>` (`FAAS_WORKLOAD_<NAME>_SHARED_DIR`) for Unix sockets and transient files.

## Ordering, probes, `primary_ingress`, and least-privilege secrets

- **Health-gated startup (`depends_on` and `main_depends_on`):** Declare `exec`, `http_get`, or `tcp_socket` `startup_probe`, `liveness_probe`, and `readiness_probe` checks so `main` or downstream helpers wait for `started`, `healthy`, or `completed_successfully` before accepting requests.
- **Custom reverse proxy as ingress (`primary_ingress: true`):** A sidecar proxy can claim the app's public hostname and custom domains. If `readiness_probe` fails, Gregale removes the instance from public routing without killing it—and during traffic-split rollouts, all live deployments must agree on the primary companion and port or routing fails closed.
- **Explicit `env_secrets` per companion:** Companions never inherit the main app's secrets automatically. You grant individual secrets explicitly (`env_secrets`), and long-running sidecars can even opt into `com.gregale.secret-reload-signal` independently.

## Security, networking, and resource caveats to know first

- **Declared `port` opens a companion hostname:** Declaring `port` exposes `<app>--<companion>.<apps domain>` publicly at the edge alongside injecting `FAAS_WORKLOAD_<NAME>_ADDR`. For helpers that should stay strictly private, omit `port` and talk over Unix sockets in `FAAS_WORKLOAD_<NAME>_SHARED_DIR`, authenticate callers inside the companion, or protect `@app` hosts with edge rules.
- **Read-only root filesystem:** A companion's root image is read-only; only `/tmp` and its shared directory are writable (ephemeral per instance). Point caches and PID files at `/tmp`.
- **Limits and isolation:** Each deployment supports at most four long-running companions and one one-shot setup helper; stateful database images are rejected; companion `ram_mb` adds to billable instance RAM; and companions inside one deployment share that microVM's guest kernel, so mutually untrusted code belongs in separate deployments.

See [Application companions](/docs/companions), [Trace requests](/docs/tracing), [Manage secrets](/docs/secrets), [A microVM for every app](/articles/microvm-isolation), and [Gregale pricing](/pricing).
