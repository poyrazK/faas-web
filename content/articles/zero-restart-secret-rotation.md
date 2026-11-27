**Rotate or revoke application secrets on Gregale without stale memory snapshots surviving or blindly dropping live connections.** Every secret update immediately invalidates existing memory snapshots so restored microVMs never serve revoked credentials, `--restart` runs a draining rolling replacement, and opted-in containers can hot-reload secrets in-process with verifiable application acknowledgements and durable revocation records.

## Why secret rotation breaks on traditional PaaS platforms

On many PaaS providers, rotating a database password or third-party token forces a cold restart of running containers—or worse, snapshot-based scale-to-zero platforms risk waking paused containers with yesterday's environment values. Security teams also lack proof after an incident: deleting an env var in a dashboard does not verify whether every running process actually stopped using the old key.

## Safe defaults: snapshot invalidation and draining restarts

By default on Gregale, secrets are write-only to the API, sealed at rest, and delivered into the guest only at wake:

```bash
gregale env set --app my-api STRIPE_SECRET_KEY="$STRIPE_SECRET_KEY"
gregale env rotate --app my-api DATABASE_URL="$NEW_DATABASE_URL" --restart
gregale env list --app my-api
gregale env unset --app my-api STRIPE_SECRET_KEY
```

Three platform guarantees prevent stale secrets even without application code changes:

- **Automatic snapshot invalidation:** Whenever a secret changes, existing memory snapshots are invalidated immediately. The next cold wake boots fresh with the updated environment before capturing a new snapshot, and `--restart` prevents live processes carrying the old environment from ever being snapshotted.
- **Draining rolling replacement (`--restart`):** Gregale cold-boots replacement instances with the new values, routes traffic to them, waits for gateway convergence and in-flight requests to drain, and then tears down the old instances.
- **Version-fenced delivery states:** `gregale env list` tracks each key as `pending`, `delivered`, or `failed` tied to exact wake and instance IDs, so racing observations from an older wake can never mark a newer version delivered.

For multi-service apps, project environment secrets (`gregale environment secrets set shop production`) share credentials across every service in the environment (up to `Free 8`, `Hobby 25`, `Pro 50`, `Scale 100` per environment) without repeating per-app edits.

## Zero-restart hot reload and startup readiness

Applications that can swap database pools or API clients inside a live process can opt in with an OCI image label:

```dockerfile
LABEL com.gregale.secret-reload-signal="SIGHUP"
LABEL com.gregale.secret-reload-readiness="required"
```

1. On start, after registering its signal handler (`SIGHUP`, `SIGUSR1`, or `SIGUSR2`, distinct from `STOPSIGNAL`), the app writes `ready\n` to `FAAS_SECRETS_RELOAD_READY_FILE` so signals never arrive before handlers are installed.
2. When a secret changes, guest-init (polling every 10 seconds) writes an atomic mode-`0400` snapshot `{revision,secrets}` on `/tmp` tmpfs (`FAAS_SECRETS_SNAPSHOT_FILE`) and signals the workload.
3. After updating its internal pools/clients, the app can POST its self-attestation (`revision`, `status: "applied"`, and `FAAS_SECRETS_RELOAD_GENERATION`) to `FAAS_SECRETS_RELOAD_ACK_ENDPOINT`.

Process generations isolate restarts inside the VM so an exiting process's late acknowledgement can never overwrite a new process's status.

## Verify rotation and revocation from CI or incident scripts

```bash
gregale env rotate --app my-api DATABASE_URL="$NEW_DATABASE_URL" --wait-for-ack
gregale env unset --app my-api COMPROMISED_KEY --wait-for-ack --timeout 2m
```

- `secrets rotate --wait-for-ack` polls the complete roster of authorized active runtimes until every reload-enabled target acknowledges the current revision, failing fast with a non-zero exit if any target lacks reload support or reports failure.
- `gregale env unset --wait-for-ack --timeout 2m` records a durable, value-free revocation record (queryable at `GET /v1/apps/{slug}/secret-revocations/{id}`) containing the exact target roster, status codes, and timestamps—and exits non-zero if any runtime times out or cannot live-reload.

## Managed Postgres: the old login stays valid until the refresh completes

Database credentials follow the same rules, with one addition: during a rotation both logins work.

```bash
gregale postgres bindings list orders
gregale postgres bindings rotate BINDING_ID --wait
```

- Rotation creates the next database login and replaces the sealed app secret, which invalidates existing snapshots.
- The previous login stays valid until Gregale confirms the rolling runtime refresh; then it is revoked with retry-safe cleanup. The binding reports `rotation_pending` while both logins exist, and `--wait` polls until that clears, for up to five minutes (`--wait-timeout`). An app with no live deployment or running instances has its old login queued for cleanup right away.
- A retried rotation reuses its generation, and recovery queues the refresh even if the original request failed or the worker restarted.
- To switch pools inside a running process, start from the `rest-api-postgres` or `rest-api-postgres-python` starter (`gregale init --template rest-api-postgres`). Both ship a `SecretReloadCoordinator` and set the SIGHUP reload label: on a new secret revision it builds a fresh pool, validates it with a real connection, publishes it, retires older pools once their last lease is released, and acknowledges the revision only after every consumer succeeds. New acquisitions fail closed during the switch; queries that already hold a connection finish.

See [Managed PostgreSQL](/docs/postgres) for the binding commands.

## What to expect and when to use `--restart`

- **Self-attestation vs memory inspection:** Application acknowledgements reflect trusted app self-reporting; removing a key from the projected file cannot purge credentials your app forgot to drop from heap variables.
- **No handler? Use `--restart`:** Images without `com.gregale.secret-reload-signal` cannot live-reload and fail `--wait-for-ack` intentionally rather than silently succeeding; use `--restart` for apps that read `process.env` only once at boot.

See [Manage secrets](/docs/secrets), [Set environment variables](/docs/env), [How scaling to zero works](/docs/scale-to-zero), and [Security](/docs/security).
