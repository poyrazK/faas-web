**On Gregale, `gregale domain doctor api.example.com` tells you why a custom
domain is stuck on pending: it runs five DNS and certificate checks and prints
the exact record to add or remove.** It changes nothing, and it exits nonzero
while the domain isn't ready, so it also works in a script. Custom domains
are on every plan, Free included; the doctor is in preview.

## Find the missing record

```bash
# Five checks, each with the fix
gregale domain doctor api.example.com

# The records Gregale expects, and the overall status
gregale domain get api.example.com

# Check again now, or wait until the domain is ready
gregale domain verify api.example.com
gregale domain verify api.example.com --wait --timeout 10m
```

For a name with no DNS records yet, the doctor answered:

```text
Status:      2 of 5 checks failing

[fail]    dns_record             no DNS record resolves at api.example.com
                                fix:       Set CNAME api.example.com → edge.gregale.dev
[fail]    points_to_gregale      no Gregale CNAME target was observed
                                fix:       Set CNAME api.example.com → edge.gregale.dev
[pending] tls_certificate        ownership not verified: the _faas-verify TXT record has not been seen, and no certificate is issued until it is
                                fix:       Publish TXT _faas-verify.api.example.com with the value d5590b4295655f5f3df677d35b7d2b6d.
[ok]      caa_permits            CAA permits certificate issuance
[ok]      ipv6_conflict          no stray AAAA at apex
```

## Match the check to the fix

| What the doctor says                                                       | Fix                                                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `dns_record` fail: no DNS record resolves                                  | Add the CNAME `gregale domain create` printed                                                     |
| `points_to_gregale` fail: no Gregale CNAME target was observed             | The name points somewhere else; change the CNAME to the printed target                            |
| `tls_certificate` pending: the `_faas-verify` TXT record has not been seen | Publish the TXT record with the exact value shown; no certificate is issued until it is seen      |
| Routing pending: DNS routing could not be confirmed                        | Something else answers for the name, such as a proxy or old records; the doctor lists what it saw |
| `ipv6_conflict`                                                            | Remove the stray AAAA record that points elsewhere                                                |
| `caa_permits` fail                                                         | Your CAA records must allow `letsencrypt.org`                                                     |
| Status `dns_drifted`                                                       | A record was removed or changed after setup; put it back                                          |

## The usual causes

- **The TXT record is missing or on the wrong name.** It goes on
  `_faas-verify.api.example.com`, not on `api.example.com`. Some DNS
  providers add your zone name to what you type, giving
  `_faas-verify.api.example.com.example.com`; enter only the part before
  your zone if yours does.
- **A proxy answers for the name.** Point the name straight at Gregale. A
  proxied (orange-cloud) Cloudflare record stops Gregale from getting a
  certificate; set it to DNS only.
- **Old records are still there.** Delete the A and AAAA records left from
  a previous host before you add the CNAME. A stray AAAA record is what
  `ipv6_conflict` reports.
- **The certificate hasn't been requested yet.** Once ownership and routing
  check out, the certificate is issued on the first HTTPS connection, usually
  within a minute.

Gregale checks a pending domain automatically. `gregale domain verify`
checks it at once, at most every fifteen seconds. An unverified domain
releases its name after 7 days. To be walked through the records in a
terminal, run `gregale domain setup api.example.com --app my-api`, which
waits until the domain is ready.

## What we measured

We bound three hostnames whose DNS we don't control to a test app on
2026-11-28, so they stayed pending:

- **No records:** `domain doctor` reported 2 of 5 checks failing, printed
  the CNAME and TXT values to add, and exited with status 1.
- **A name answered by another CDN:** the routing checks stayed pending with
  "DNS routing could not be confirmed", and the doctor listed the IPv6
  addresses it saw.
- **`domain verify`:** reported `awaiting_ownership` with ownership pending,
  routing failing and TLS pending, the next automatic check 29 s later, and
  the claim's expiry 7 days out.
- **Names Gregale owns:** a `gregale.dev` hostname was refused with "attach
  a domain you own".

## How other platforms compare

| Platform    | Diagnosing a custom domain that won't verify                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Gregale** | `gregale domain doctor` runs five checks and prints the record to fix; `domain verify --wait` waits until it is ready          |
| **Vercel**  | The dashboard shows an Invalid Configuration alert; a domain used by another Vercel account must be verified with a TXT record |
| **Fly.io**  | `fly certs check <hostname>` shows validation progress; ownership is proven with a `_fly-ownership` TXT or an AAAA record      |
| **Render**  | A Cloudflare record must be set to DNS only so Render can verify the domain and issue a certificate                            |

Checked against each vendor's public documentation on November 28, 2026:
[Vercel: troubleshooting domains](https://vercel.com/docs/domains/troubleshooting),
[Fly.io custom domains](https://fly.io/docs/networking/custom-domain/),
[Render: configuring Cloudflare DNS](https://render.com/docs/configure-cloudflare-dns).

## Pricing

Custom domains and their certificates cost nothing extra on every plan:
Free, Hobby ($10 a month), Pro ($30) and Scale ($99). Wildcard domains are
on Pro and Scale. See [Domains](/docs/custom-domains) and
[Gregale pricing](/pricing).
