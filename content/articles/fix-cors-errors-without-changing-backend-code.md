**On Gregale, one command fixes a browser CORS error without touching your
backend: `gregale edge cors allow my-api https://app.example.com`. Gregale's
edge answers the browser's preflight and adds the CORS headers to your app's
responses.** The preflight `OPTIONS` request is answered with `204` at the
edge, so it never wakes your app or reaches your code. Edge rules, CORS rules
included, are in beta on every plan, Free included.

## Fix it

```bash
# Let your frontend call the API
gregale edge cors allow my-api https://app.example.com

# Several origins, and cookies or an Authorization header from the browser
gregale edge cors allow my-api https://app.example.com https://admin.example.com --credentials

# Allow one more request header your frontend sends
gregale edge cors allow my-api https://app.example.com --credentials --allow-header X-Request-Id

gregale edge cors list my-api
gregale edge cors delete <rule-id>
```

The defaults cover most APIs:

| Setting                  | Default                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------- |
| Methods                  | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`                                       |
| Request headers          | `*`; with `--credentials`: `Accept`, `Authorization`, `Content-Type`, `X-Requested-With` |
| `Access-Control-Max-Age` | 600 seconds (`--max-age`, at most 86400)                                                 |
| Host                     | The app's first verified custom domain, or its own address when it has none (`--host`)   |

## Match the error to the fix

| What the browser console says                                                                         | Fix                                                                             |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| No `Access-Control-Allow-Origin` header is present on the requested resource                          | Allow the page's origin, exactly as the browser sends it: scheme, host and port |
| Response to preflight request doesn't pass access control check                                       | Your app doesn't answer `OPTIONS`; the CORS rule answers it at the edge         |
| The value of `Access-Control-Allow-Origin` must not be the wildcard `*` when credentials are included | List the origins and add `--credentials`                                        |
| Request header field `x-request-id` is not allowed                                                    | Add `--allow-header X-Request-Id`                                               |

A CORS error is the browser's rule, not your server's: the same request
from `curl` works. That is why the fix belongs in front of the app.

## Full control with an edge rule

`gregale edge cors allow` creates a simple `cors` edge rule. For other
methods, several hosts or a different path, write the rule yourself
(`POST /v1/apps/{slug}/edge-rules`):

```json
{
  "kind": "cors",
  "match_host": "api.example.com",
  "match_path": "/**",
  "action": {
    "allow_origins": ["https://app.example.com", "https://*.example.com"],
    "allow_methods": ["GET", "POST"],
    "allow_headers": ["Authorization", "Content-Type"],
    "allow_credentials": true,
    "max_age_seconds": 600
  }
}
```

An origin is `*`, `https://host[:port]`, `https://*.host` for subdomains, or
`https://host:*` for any port. To protect your users, `*` can't be combined
with `allow_credentials`, and neither can a wildcard under a public suffix
such as `https://*.vercel.app` or `https://*.github.io`, where anyone can
register a name. On Hobby and above, a CORS preset (`/v1/cors-presets`) shares
one origin list across several rules.

## How other platforms compare

| Platform    | Adding CORS to a backend without changing its code                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Gregale** | One command; the edge answers the preflight and adds the headers, and preflights never wake the app                                                                      |
| **Vercel**  | `headers` in `vercel.json` set fixed headers; for preflights or an origin that varies by request, Vercel points to middleware or an `OPTIONS` route handler in your code |
| **Render**  | Custom header rules are a static-site feature; a web service sends its own CORS headers                                                                                  |
| **Railway** | No header setting; a Railway moderator says you would code your application to send those headers                                                                        |
| **Fly.io**  | `fly.toml` can add fixed response headers, the same for every origin; the app still answers preflights                                                                   |

Checked against each vendor's public documentation and forum answers on
November 27, 2026:
[Vercel: how to enable CORS](https://vercel.com/kb/guide/how-to-enable-cors),
[Render static site headers](https://render.com/docs/static-site-headers),
[Railway: adding custom HTTP headers](https://station.railway.com/questions/how-to-add-custom-http-headers-to-deploy-e284959e),
[Fly.io response header modification](https://community.fly.io/t/new-feature-basic-http-response-header-modification/3594).

## Pricing

CORS rules cost nothing extra. They count toward your plan's edge rules per
app: 5 on Free, 25 on Hobby ($10 a month), 100 on Pro ($30) and 500 on Scale
($99). Preflights answered at the edge never wake your app, so they add no
running time. See [Edge rules](/docs/edge-rules#cors) and
[Gregale pricing](/pricing).
