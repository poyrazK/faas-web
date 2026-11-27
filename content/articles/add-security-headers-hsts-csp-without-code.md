**Gregale already sends `Strict-Transport-Security`, `X-Content-Type-Options:
nosniff` and a `Referrer-Policy` for every app that doesn't set its own. One
edge rule adds a `Content-Security-Policy`, `X-Frame-Options` or any other
header to every response, without changing your code.** Your app's own values
always win over the defaults. Security headers and edge rules are in beta on
every plan, Free included.

## What you get without doing anything

When your app sets none of these headers, Gregale adds:

| Header                      | On your app's own address             | On your custom domain             |
| --------------------------- | ------------------------------------- | --------------------------------- |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | `max-age=31536000`                |
| `X-Content-Type-Options`    | `nosniff`                             | `nosniff`                         |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`     | `strict-origin-when-cross-origin` |
| `X-Frame-Options`           | none                                  | none                              |
| `Permissions-Policy`        | none                                  | none                              |

When your app sets one of them itself, Gregale sends your value unchanged.

## Add a Content-Security-Policy and the rest

```bash
gregale edge rule create --app my-app --kind headers --match-host @app --match-path '/**' \
  --headers-response-set "Content-Security-Policy:default-src 'self'; frame-ancestors 'none'" \
  --headers-response-set 'X-Frame-Options:DENY' \
  --headers-response-set 'Permissions-Policy:camera=(), microphone=(), geolocation=()' \
  --headers-response-remove Server
```

- **`--match-host @app`** covers every host the app serves, custom domains
  included, even ones you add later.
- **`--match-path '/**'`** covers every path. Without it, a rule matches only
  the root path `/`.
- **`set`** replaces the header, so the rule's value wins over one your app
  sends; `--headers-response-add` appends a value and `--headers-response-remove`
  deletes the header.

Check the result:

```bash
curl -sI https://my-app.example.com/ | grep -i -E 'strict-transport|content-security|x-frame|permissions'
```

## Roll out a CSP without breaking the site

A strict policy can block your own scripts. Send it in report-only mode first:
the browser reports violations in its console and blocks nothing.

```bash
gregale edge rule create --app my-app --kind headers --match-host @app --match-path '/**' \
  --headers-response-set "Content-Security-Policy-Report-Only:default-src 'self'"
```

When the console stays clean, switch the header name to
`Content-Security-Policy`.

## HSTS on a custom domain

On a custom domain, the default HSTS header does not include subdomains,
because Gregale does not serve your other subdomains. Once every subdomain
serves HTTPS, add them yourself:

```bash
gregale edge rule create --app my-app --kind headers --match-host @app --match-path '/**' \
  --headers-response-set 'Strict-Transport-Security:max-age=63072000; includeSubDomains; preload'
```

Browsers remember HSTS for the whole `max-age`, so add `preload` only when you
are sure.

## How other platforms compare

| Platform    | Security headers on a backend without changing its code                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------- |
| **Gregale** | HSTS, `nosniff` and `Referrer-Policy` by default; any other header with one edge rule, on every path and host |
| **Vercel**  | A `headers` list in `vercel.json` sets response headers by path                                               |
| **Render**  | Custom header rules are a static-site feature; a web service sets its own headers                             |
| **Railway** | No header setting; a Railway moderator says you would code your application to send those headers             |
| **Fly.io**  | `fly.toml` can add or remove fixed response headers                                                           |

Checked against each vendor's public documentation and forum answers on
November 27, 2026:
[Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json),
[Render static site headers](https://render.com/docs/static-site-headers),
[Railway: adding custom HTTP headers](https://station.railway.com/questions/how-to-add-custom-http-headers-to-deploy-e284959e),
[Fly.io response header modification](https://community.fly.io/t/new-feature-basic-http-response-header-modification/3594).

## Pricing

Security headers cost nothing extra. A `headers` rule counts toward your plan's
edge rules per app: 5 on Free, 25 on Hobby ($10 a month), 100 on Pro ($30) and
500 on Scale ($99). See [Security headers on your app](/docs/security#security-headers-on-your-app),
[Edge rules](/docs/edge-rules#headers) and [Gregale pricing](/pricing).
