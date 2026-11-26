**Connect backend microservices privately by name—with auto-injected service URLs, caller allowlists, method and path scopes, and default-deny PR preview isolation—without configuring a VPC, subnet, or NAT gateway.** On Gregale, apps in the same account reach each other directly over platform-managed private networking, enforced at the proxy before unpermitted callers can even wake a target microVM.

## Why internal service networking is usually too complex or too open

On AWS or GCP, private service-to-service communication means provisioning VPC subnets, security groups, internal load balancers, and private DNS zones—plus custom IAM/mTLS checks if you want caller-level authorization. Conversely, many simple PaaS platforms either expose every internal service over the public internet or drop apps onto a flat internal network where any service or preview branch can call production billing endpoints.

## Zero-config discovery paired with least-privilege caller scopes

Declare service dependencies with `depends_on` in Compose (`compose.yaml` or `docker-compose.yml`) or the `project:` block in `gregale.yaml` (and on `POST /v1/apps` for standalone apps):

```yaml
x-gregale-service-policy: project

services:
  public-api:
    build: ./public-api
    depends_on: [billing]
    x-gregale-service-reliability:
      billing:
        timeout_ms: 1500
        max_attempts: 2
        min_remaining_ms: 200
        retry_budget_percent: 10
  billing:
    build: ./billing
    x-gregale-allow-callers: [public-api]
    x-gregale-allow-call-scopes:
      public-api:
        methods: [GET, POST]
        path_prefixes: [/v1/invoices, /v1/checkout]
```

Gregale validates the dependency graph before deploy and wires everything automatically:

- **Auto-injected endpoints:** `public-api` receives `GREGALE_SERVICE_BILLING_URL` on port `10081` (`http://billing.svc.gregale:10081`), and bound services also resolve at `http://billing.internal:10081`.
- **Project and declared policies:** New project workloads default to `x-gregale-service-policy: project`, blocking accidental cross-project calls with `403`; `declared` restricts callers strictly to names listed in `depends_on`.
- **Target allowlists and path prefixes:** `x-gregale-allow-callers` (up to `100` slugs; `[]` denies all internal calls) and `x-gregale-allow-call-scopes` restrict callers by normalized HTTP method and slash-delimited path prefix (`/v1/invoices` allows `/v1/invoices/42`, not `/v1/invoices-archive`). Violations fail closed at the gateway **before looking up or waking the target VM**.
- **Built-in deadlines and transport retries:** `x-gregale-service-reliability` enforces end-to-end call budgets covering wake time, routing, and safe transport retries.

## Private HTTPS and PR preview isolation

- **Opt-in private HTTPS:** Setting `x-gregale-service-transport: https` injects `https://<service>.internal` as the primary `_URL`, blocks plain HTTP downgrades at the proxy, and wires `GREGALE_SERVICE_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`, and `SSL_CERT_FILE` cleanly in `/tmp` without mutating OS images (rolling out per account).
- **Default-deny PR preview isolation:** Every project defaults to `preview_service_policy: deny`, rejecting calls from PR previews to production services with `403 preview_production_dependency_denied` before waking production. Even when explicitly opted in via `allow_marked`, production targets can independently refuse previews (`x-gregale-preview-calls: deny`) or inspect platform-owned `X-Faas-Caller-Env: preview` and `X-Faas-Caller-Preview-Of` headers.
- **Signed caller assertions (Preview):** Where enabled, internal hops carry a 30-second `X-Faas-Caller-Assertion` EdDSA JWT binding `sub` (caller ID) and `aud` (target ID) so a downstream service cannot replay an assertion against another service.

## When a full VPC or service mesh fits better

If your services must peer directly into an existing AWS VPC/RDS PrivateLink network without crossing the public internet, span multiple cloud regions with custom L3/L4 routing rules, or peer workloads across separate organizations, a traditional cloud VPC or Kubernetes service mesh fits better.

See [Internal services](/docs/internal-services), [Service bindings](/docs/service-bindings), [Multi-service apps](/docs/multi-service), [Preview environments](/docs/preview-environments), and [Networking](/docs/networking).
