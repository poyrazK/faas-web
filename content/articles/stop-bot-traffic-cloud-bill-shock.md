**To stop bot traffic and DDoS spikes from inflating your cloud bill _without_ taking legitimate users offline, refuse bad requests at the edge before your app wakes — backed by a default hard monthly spend cap.** Most platforms solve surprise bills with a billing circuit breaker alone (Vercel Spend Management pauses production deployments; Railway hard limits take all workloads offline; Cloud Run spend-cap budgets pause new execution), which lets automated scrapers or exploit scanners burn through your budget cap and take your app down.

## Why spend caps alone aren't enough

| Platform mechanism                   | Stops runaway invoice?   | What happens during a bot or scanner flood                                                                                        |
| ------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel Pro Spend Management**      | Yes (auto-pause enabled) | Bots/crawlers consume included + overage usage, then production pauses offline                                                    |
| **Railway Hard Usage Limit**         | Yes                      | Traffic spike drains monthly limit, then all services are taken offline                                                           |
| **Cloud Run Spend Cap Budget**       | Yes (scoped services)    | Unblocked bots invoke containers until 100% cap pauses new requests                                                               |
| **Gregale Pre-Wake Edge + Hard Cap** | Yes (enabled by default) | Edge WAF (`403`), proof-of-work challenge, rate limits, and edge cache stop bots at `$0` compute; app wakes only for real traffic |

## How Gregale blocks hostile traffic at $0 compute

Gregale evaluates edge protection rules before waking any parked Firecracker microVM, and explicitly charges **$0** for requests refused at the edge:

1. **In-path OWASP WAF (`kind=waf`, Pro & Scale):** Checks matched headers and URLs against the OWASP Core Rule Set for SQLi, XSS, path traversal, command injection, and vulnerability scanners. In `block` mode (paranoia level 1), malicious probes receive `403` without waking your app.
2. **Proof-of-work browser challenge (`kind=challenge`, Hobby & above):** Stops scrapers cleanly with a lightweight client proof-of-work pass cookie (no third-party CAPTCHA scripts) while exempting API callers that send a verified API key, consumer key, or JWT.
3. **Rate limits, IP/country blocks, and edge response caching:** Throttle abusive IPs or cache repeated `GET`/`HEAD` responses at the edge so bots or repeat polling never start a microVM.
4. **Hard monthly spend caps by default:** Every paid plan still starts with a hard overage cap (Hobby `$10` default, Pro `$50`, Scale `$150`) plus automatic PR preview stops so even a legitimate viral spike cannot trigger an uncapped bill.

```sh
# Test edge rules deterministically before applying to production
gregale edge rule trace my-api --file ./edge-trace.json

# Verify your monthly hard spend cap
gregale billing spend-cap
```

## Sources

- [Security & WAF](/docs/security)
- [Edge rules](/docs/edge-rules)
- [Cost controls & spend caps](/docs/cost-controls)
