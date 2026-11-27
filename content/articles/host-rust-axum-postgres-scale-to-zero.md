**A Rust API built with Axum and sqlx deploys on Gregale from a two-stage
Dockerfile: compile with Cargo, then copy the binary into a small runtime
image. Migrations run as a release command with their own credential, and
between requests the app pauses, so idle time is not billed.** In our test
the compiled API used 8 MB of memory and its image was 57 MB. That fits the
Free plan's 256 MB, but Free has no managed PostgreSQL, so a Rust API with a
database needs Hobby.

## The app

An Axum 0.8 API with one table, `notes`, using sqlx 0.8 for PostgreSQL.
`Cargo.toml`:

```toml
[package]
name = "notes-api"
version = "0.1.0"
edition = "2024"
rust-version = "1.85"

[dependencies]
axum = "0.8"
serde = { version = "1", features = ["derive"] }
sqlx = { version = "0.8", default-features = false, features = ["runtime-tokio", "tls-rustls-ring-webpki", "postgres", "migrate", "macros"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }

[profile.release]
strip = true
```

sqlx uses rustls for TLS here, so the binary does not link OpenSSL.

`src/main.rs`:

```rust
use axum::{Json, Router, extract::State, http::StatusCode, routing::get};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{env, time::Duration};

#[derive(Serialize, sqlx::FromRow)]
struct Note {
    id: i64,
    body: String,
}

#[derive(Deserialize)]
struct NewNote {
    body: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // `notes-api migrate` is the release command: it gets the direct,
    // schema-changing credential; the serving process never sees it.
    if env::args().nth(1).as_deref() == Some("migrate") {
        let url = env::var("MIGRATION_DATABASE_URL")?;
        let pool = PgPoolOptions::new().max_connections(1).connect(&url).await?;
        sqlx::migrate!().run(&pool).await?;
        println!("migrations applied");
        return Ok(());
    }

    // Lazy: the app starts and answers /healthz without touching the
    // database, so an idle database never delays a wake.
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(10))
        .connect_lazy(&env::var("DATABASE_URL")?)?;

    let app = Router::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/notes", get(list).post(create))
        .with_state(pool);

    let port = env::var("PORT").unwrap_or_else(|_| "8080".into());
    let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn list(State(db): State<PgPool>) -> Result<Json<Vec<Note>>, StatusCode> {
    sqlx::query_as::<_, Note>("SELECT id, body FROM notes ORDER BY id DESC LIMIT 50")
        .fetch_all(&db)
        .await
        .map(Json)
        .map_err(internal)
}

async fn create(
    State(db): State<PgPool>,
    Json(note): Json<NewNote>,
) -> Result<(StatusCode, Json<Note>), StatusCode> {
    sqlx::query_as::<_, Note>("INSERT INTO notes (body) VALUES ($1) RETURNING id, body")
        .bind(note.body)
        .fetch_one(&db)
        .await
        .map(|note| (StatusCode::CREATED, Json(note)))
        .map_err(internal)
}

fn internal(err: sqlx::Error) -> StatusCode {
    eprintln!("database error: {err}");
    StatusCode::INTERNAL_SERVER_ERROR
}
```

`migrations/0001_create_notes.sql`:

```sql
CREATE TABLE notes (
    id BIGSERIAL PRIMARY KEY,
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The same binary serves requests and runs migrations. Gregale passes the
release command its arguments, so `notes-api migrate` takes the first
branch.

## Dockerfile and gregale.yaml

Gregale builds Node, Python and Go from source without a Dockerfile. For
Rust, add one at the project root:

```dockerfile
FROM rust:1-slim-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src src
COPY migrations migrations
RUN cargo build --release --locked
FROM gcr.io/distroless/cc-debian12
COPY --from=build /src/target/release/notes-api /app/notes-api
EXPOSE 8080
CMD ["/app/notes-api"]
```

- `sqlx::migrate!()` embeds the `migrations/` folder into the binary at
  compile time, so the folder is copied in before `cargo build`. The runtime
  image needs no migration files.
- `distroless/cc` has the C libraries a Rust binary links against and no
  shell or package manager.
- `--locked` builds exactly what `Cargo.lock` says. Commit the lockfile.
- The Gregale CLI leaves `target/` out of the upload, so a local build
  folder never counts against the source size limit.

`gregale.yaml`:

```yaml
access: public
hosting:
  health: /healthz
release:
  command: /app/notes-api migrate
```

`access: public` lets visitors in without a Gregale API key. Without a
`hosting.start` line, Gregale runs the image's `CMD`.

## Create the database and deploy

```bash
gregale deploy --create-only --name notes-api
gregale add postgres --app notes-api
gregale postgres attach notes-api-postgres notes-api --access migration --env MIGRATION_DATABASE_URL
gregale deploy
```

`gregale add postgres` creates the database `notes-api-postgres` and
attaches it as `DATABASE_URL`. The attach adds the migration credential.

The two credentials do different things:

- **`DATABASE_URL`** reads and writes rows but cannot `CREATE`, `ALTER` or
  `DROP` anything. It goes through a connection pooler in transaction mode,
  and the serving app only ever gets this one.
- **`MIGRATION_DATABASE_URL`** can change the schema, connects to
  PostgreSQL directly, and reaches only the release command. sqlx holds an
  advisory lock while it migrates, which needs a direct connection.

The release command runs before the new version takes traffic. If a
migration fails, the deploy stops and the previous version keeps serving.

## What we measured

We deployed this app on Gregale on 2026-11-27 with axum 0.8 and sqlx 0.8:

- **The build:** the image took 96 s to build, 69 s of it the release
  compile. Gregale's builder has 2 vCPUs, 2048 MB of memory and 15 minutes
  per build.
- **Size:** a 57 MB image, and 8 MB of memory while serving.
- **Queries through the pooler:** sqlx prepares every query, and its
  prepared statements worked through the transaction-mode pooler with no
  change to the code or the connection URL.
- **Waking up:** the snapshot restore took 67 ms and the instance was
  running 109 ms into the wake. The first byte came at 1,181 ms, because the
  database had also stopped its compute while idle and the first query
  waited for it to start.

To see the same breakdown for your app, send a request and read its
`x-faas-wake-id` response header, then:

```bash
gregale app wake-timeline notes-api <wake-id>
gregale metric resources notes-api --range 1h
```

## Things that work differently

- **Work after the response.** A `tokio::spawn` task that is still busy
  keeps the instance running, and billed. One that waits on a timer stops
  while the app is paused, and is gone when the instance parks. Run
  scheduled work from a [cron](/docs/crons) or a [job](/docs/jobs).
- **Local files.** The filesystem is ephemeral, so files written at run
  time do not survive a redeploy. Keep state in PostgreSQL or
  [object storage](/docs/object-storage).

## How other platforms host Rust

| Platform    | How Rust builds                                                                                                 | When idle                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Gregale** | Your Dockerfile                                                                                                 | Pauses about a second after the last request; not billed       |
| AWS Lambda  | OS-only runtime with the Rust runtime client; Axum through `lambda_http`; Cargo Lambda is a third-party builder | Billed per request and for the time each request runs          |
| Fly.io      | `fly launch` writes a Dockerfile that uses cargo-chef                                                           | Machines can stop when idle and start on the next request      |
| Render      | Native Rust runtime: `cargo build --release`, then `cargo run --release`                                        | Free instances spin down after 15 minutes; about 1 min to wake |

Sources, checked 2026-11-27:
[AWS Lambda: Rust](https://docs.aws.amazon.com/lambda/latest/dg/lambda-rust.html),
[Fly.io: deploy an Axum app](https://fly.io/docs/rust/frameworks/axum/),
[Fly.io: autostop and autostart](https://fly.io/docs/launch/autostop-autostart/),
[Render: deploy a Rocket app in Rust](https://render.com/docs/deploy-rocket-rust),
[Render free instances](https://render.com/docs/free).

## Pricing

Without a database, a Rust API fits Gregale Free: 1 app with 256 MB and 20
GB-RAM-hours a month. With PostgreSQL, Hobby costs $10 a month for 5 apps
with 512 MB each and 200 GB-RAM-hours, and includes one managed PostgreSQL
database. Compute is billed only while an instance runs. See
[Gregale pricing](/pricing), [Deploy a Rust app](/docs/deploy-rust) and
[Managed PostgreSQL](/docs/postgres).
