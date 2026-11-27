**On Gregale you can put a password, an API key or an IP allowlist in front of
any app with one command, and write no auth code.** `gregale app update my-api
--public-auth basic` (or `bearer`, or `ip_allowlist`) makes Gregale's edge
check every request before it reaches your app. Refused requests never wake or
reach the app, so a locked staging site costs nothing while strangers knock.
App access control is generally available: API keys on Hobby and above, basic
auth and IP allowlists on Pro and Scale.

## Lock an app

```bash
# A username and password (Pro, Scale)
gregale app update my-api --public-auth basic --basic-user team --basic-pass "$PASS"

# Only your office or VPN egress addresses (Pro, Scale)
gregale app update my-api --public-auth ip_allowlist --ip-allowlist 203.0.113.0/24 --ip-allowlist 198.51.100.7/32

# Only callers with an API key of your account (Hobby, Pro, Scale)
gregale app update my-api --public-auth bearer

# Open it to everyone again
gregale app update my-api --public-auth open
```

Each mode replaces the previous one. There is no proxy to deploy, no
middleware to add, and nothing changes in your code or your Dockerfile.

## The modes

| Mode            | Who gets through                                                                                                    | Plans             |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `open`          | Anyone.                                                                                                             | All               |
| `bearer`        | Requests with `Authorization: Bearer KEY`, where KEY is an API key of the app's account with `apps:read` or `admin` | Hobby, Pro, Scale |
| `basic`         | Requests with HTTP basic auth matching the username and password you set                                            | Pro, Scale        |
| `ip_allowlist`  | Requests from the CIDR ranges you list. Others get `403`                                                            | Pro, Scale        |
| `internal_only` | Only Gregale itself, for example to run the app's crons                                                             | All               |

- **Basic auth:** the username is 1 to 128 bytes and the password 12 to 256
  bytes. Gregale stores them encrypted. After 10 wrong passwords in a minute
  from one network (an IPv4 /24 or IPv6 /64), that network gets `429` until
  the minute is over.
- **IP allowlist:** each entry is a CIDR such as `203.0.113.0/24`; a single
  address is `/32` (IPv4) or `/128` (IPv6). A `/0` range is refused. Pro apps
  can list 16 ranges and Scale apps 64. List your office or VPN's public egress
  addresses, not private ones: the check uses the caller's address as
  Gregale's edge sees it.
- **On a plan without the mode**, the change fails with `403` and a stable code
  such as `plan_public_auth_basic_not_allowed`, so a script or an AI agent
  knows exactly why.

Need something finer, such as blocking one path, one country or one header
while the rest stays public? Use [edge rules](/docs/edge-rules) instead.

## Common uses

- **A staging or demo site** that clients can open with a shared password,
  and search engines and scanners can't.
- **An internal admin tool or dashboard** reachable only from the office or
  the company VPN.
- **An API that only your own scripts and services call**, with the account's
  API keys as the credential.
- **A webhook receiver or partner integration** that accepts calls only from
  the partner's published IP ranges.

## How other platforms compare

| Platform    | Password (basic auth) without code                                                         | IP allowlist in front of an app                                         |
| ----------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| **Gregale** | Yes, one command (Pro, Scale)                                                              | Yes, one command (Pro, Scale)                                           |
| **Railway** | No. Railway staff say basic auth is the app's job; a template runs an nginx proxy in front | No inbound IP allowlist, per Railway staff; put a CDN or proxy in front |
| **Render**  | No                                                                                         | Inbound IP rules, on Scale or Enterprise workspaces for web services    |
| **Fly.io**  | No built-in option; route traffic through your own proxy app                               | No built-in option                                                      |
| **Heroku**  | No. Add a buildpack (such as an htpasswd buildpack) or middleware in the app               | Trusted IP ranges for Private Spaces only                               |
| **Vercel**  | Password Protection, $20 per month per project on Pro (included on Enterprise)             | Trusted IPs, Enterprise only                                            |

Checked against each vendor's public documentation and staff answers on
November 27, 2026:
[Railway basic auth answer](https://station.railway.com/questions/http-basic-authentication-87aa0ba7),
[Railway IP restrictions answer](https://station.railway.com/questions/railway-ip-address-restrictions-7ddb0025),
[Railway basic auth proxy template](https://railway.com/deploy/basic-auth-proxy),
[Render inbound IP rules](https://render.com/docs/inbound-ip-rules),
[Fly.io community: protecting apps with basic auth](https://community.fly.io/t/protecting-review-apps-with-basic-auth/26830),
[Heroku htpasswd buildpack](https://elements.heroku.com/buildpacks/makairaio/htpasswd-buildpack),
[Heroku Private Spaces trusted IP ranges](https://devcenter.heroku.com/articles/private-spaces-trusted-ip-ranges),
[Vercel Password Protection](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/password-protection),
[Vercel deployment protection pricing](https://vercel.com/docs/deployment-protection/usage-and-pricing).

## Pricing

Access control has no extra charge. API-key access comes with Hobby ($10 a
month); basic auth and IP allowlists come with Pro ($30 a month) and Scale
($99 a month). Requests that the edge refuses never reach your app, so they
don't count as running time. See [Gregale pricing](/pricing) and
[App access control](/docs/auth#app-access-control) for every rule.
