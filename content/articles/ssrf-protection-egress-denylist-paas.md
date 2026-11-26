**Every app on every Gregale plan enforces a network-level egress denylist that blocks SSRF targets, cloud metadata endpoints, RFC1918 subnets, mail spam ports, and remote admin ports by default.** Even if an AI coding agent fetches a user-supplied webhook URL or a compromised dependency tries to probe local infrastructure, the platform refuses the connection before packets leave.

## Why SSRF and outbound abuse happen on standard hosts

Applications that fetch external URLs—link unfurlers, webhook dispatchers, PDF renderers, or MCP tools—routinely fall victim to Server-Side Request Forgery (SSRF) if a caller passes `http://169.254.169.254/latest/meta-data/`, `http://10.0.0.1/`, or an IPv6 NAT64 translation trick. Securing that in application code is brittle across redirects and DNS rebinding, and few PaaS platforms block malicious mining pools, raw SMTP port `25`, or internal metadata ranges uniformly across all plans.

## Blocked IP ranges, ports, and container registries

Gregale enforces outbound rules on **every app on every plan**, and even an explicit app egress allowlist entry or `gregale app egress-ports add` cannot open them:

- **Private & link-local IPv4:** Blocks `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC1918), `100.64.0.0/10` (CGNAT), and `169.254.0.0/16` (link-local, including cloud metadata `169.254.169.254`).
- **Loopback, ULA, and NAT64 IPv6:** Blocks `::/128`, `::1/128`, `fc00::/7`, `fe80::/10`, `ff00::/8`, Teredo (`2001::/32`), 6to4 (`2002::/16`), and NAT64 prefixes (`64:ff9b::/96` and `64:ff9b:1::/48`) that attackers use to smuggle IPv4 SSRF payloads.
- **Dangerous outbound TCP ports:** Always closes remote administration (`22`, `23`, `3389`, `5900`), plaintext/relay SMTP (`25`, `2525`—while keeping submission ports `465` and `587` open only to explicitly allowlisted mail providers), external DNS (`53`, `853`—forcing lookups through Gregale's resolver), Windows RPC/SMB (`135`, `137`, `138`, `139`, `445`), mining pools (`3333`, `4444`, `5555`, `7777`, `14433`, `14444`, `45700`), and IRC (`6660`–`6669`, `6697`).
- **Safe container image pulls:** Deployment pulls also refuse container registries resolving to loopback (`127.0.0.0/8`), unspecified (`0.0.0.0/8`), benchmarking (`198.18.0.0/15`), `192.0.0.0/24`, or reserved (`240.0.0.0/4`) ranges.

An app can widen what it reaches, but never past these rules:

```bash
gregale app egress-allowlist add my-api 203.0.113.10/32   # Hobby and up: pin the app to the ranges it calls
gregale app egress-ports add my-api 8443                  # Pro and Scale: one more outbound port
gregale app egress-ports add my-api 25                    # refused: port 25 is always closed
```

## Layered isolation with microVMs and zero-secret relays

The egress denylist works together with per-app [Firecracker microVM isolation](/articles/microvm-isolation)—each workload runs in its own guest kernel and network namespace—and Gregale's optional [zero-secret outbound API relay](/articles/zero-secret-outbound-api-relay) so third-party tokens stay outside application memory completely.

## Tradeoffs for internal and legacy workloads

Because SMTP ports `25` and `2525` and SSH port `22` are permanently closed outbound, applications must send transactional email over an HTTPS API or allowlisted `465`/`587` submission relays, and should use HTTPS APIs or managed S3 rather than SFTP on port `22`. Platform egress rules are fixed boundaries that complement, rather than replace, application URL validation.

See [Blocked outbound destinations](/docs/egress-denylist), [Security](/docs/security), [Networking](/docs/networking), [A microVM for every app](/articles/microvm-isolation), and [Call Stripe, OpenAI and third-party APIs without API keys in your app](/articles/zero-secret-outbound-api-relay).
