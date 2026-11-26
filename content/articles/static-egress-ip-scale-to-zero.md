**Reserve a static outbound IP address for your app without running a Virtual Private Cloud (VPC) or an always-on NAT gateway.** When a bank, payment processor, enterprise database, or partner API requires an IP allowlist, Gregale lets you bind a static egress address per app and region so outbound connections arrive from one known IP even while compute scales to zero.

## Why scale-to-zero APIs break IP allowlists

Most serverless and container PaaS platforms pull outbound connections from shared ephemeral NAT pools whose IP addresses rotate across cold starts, hosts, and deploys. On hyperscalers such as AWS Lambda or Cloud Run, getting a stable outbound address typically forces you into private VPC subnets, public subnets, route tables, and managed NAT gateways priced hourly plus per-gigabyte processed—even when your backend sends only a few dozen webhook or banking requests a day.

## Assign a static egress IP on Gregale

Bind, inspect, and clear a static outbound address for a selected app from the Gregale CLI:

```bash
gregale app APP_ID static-egress-ip set 203.0.113.42
gregale app APP_ID static-egress-ip show
gregale app APP_ID static-egress-ip clear
```

- **Outbound only:** The address applies to outbound connections made by the selected app in its region and does not change inbound routing.
- **No hard-coded configuration:** The API reports availability and any charge before allocating the address; keep it out of application configuration files.
- **Plan and region availability:** Static egress IP allocation is plan- and region-dependent, so check availability for the app's region before onboarding a strict allowlist partner.

## Safe rollout and removal workflow

Because external allowlists take time to propagate on partner systems, treat static egress changes as planned operations:

1. **Allocate before switching traffic:** Reserve the static egress IP first, add it to your upstream database, SFTP host, or banking allowlist, and verify connectivity using a safe read-only endpoint.
2. **Coordinate removals carefully:** Clearing the static egress IP returns the app to shared egress routing and will immediately break allowlisted integrations if the partner still enforces the rule.
3. **Pair with egress controls:** Combine static egress IPs with [blocked outbound destinations](/docs/egress-denylist) and, where strict credential isolation is required, [zero-secret outbound API relay](/articles/zero-secret-outbound-api-relay).

## Tradeoffs vs DIY NAT gateways

Allocating a static egress address on Gregale removes VPC subnets, NAT gateway maintenance, and idle NAT infrastructure sprawl when your goal is partner IP allowlisting. If you need custom private peering across your own AWS or GCP VPCs rather than allowlisted public endpoints, a hyperscaler VPC remains the more direct fit.

See [Static egress IP](/docs/static-egress-ip), [Networking](/docs/networking), [Outbound integrations](/docs/outbound-integrations), [Call Stripe, OpenAI and third-party APIs without API keys in your app](/articles/zero-secret-outbound-api-relay), and [Gregale pricing](/pricing).
