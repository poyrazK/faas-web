**On Gregale you don't build a "waking up" page: when a browser opens a page on
an app that is still waking after 1.5 seconds, Gregale's edge answers with a
"Waking up your app…" page that turns into your app as soon as it is ready.**
API clients never get that page; their requests wait for the app as usual.
The waking page is generally available on every plan, Free included, and
needs no setting.

## What a visitor sees

1. A browser opens your app's URL while the app is parked.
2. Gregale starts waking the app. Most wakes restore a memory snapshot and
   answer within a fraction of a second, so the visitor sees your page directly.
3. If the app is still waking after 1.5 seconds, the browser gets a short
   page saying the app is waking up. It checks again every 750 milliseconds.
4. When the app is ready, the browser loads the same URL again and shows your
   app.

The wake keeps going in the background while the page is shown, so no visit is
dropped and nobody has to press reload.

## Which requests get the page

Only browser page loads: `GET` or `HEAD` requests that ask for HTML and, when
the browser says so, are navigations to a document. Everything else waits for
the app instead:

- `fetch()` and XHR calls from your frontend, even ones that accept HTML
- API clients, `curl` and webhooks, which don't ask for `text/html`
- `POST` form submissions

So a JSON API never receives an HTML page in place of its response; its
request is held until the app is ready, then answered by the app.

The page is sent with `Cache-Control: no-store`, so no browser or CDN keeps
it, and with `X-Robots-Tag: noindex, nofollow, noarchive`. It carries the header
`x-faas-wake-page: 1`, which uptime checks and tests can look for.

## See how your app woke

Every routed response says how the request was served:

```bash
curl -sI https://my-app.gregale.app/ | grep -i x-faas-wake
```

`x-faas-wake: hot` means an instance was already running, `restored` that it
woke from a snapshot, and `cold` that it booted fresh. A cold boot, such as
the first start after a deploy, is when a slow-starting app is most likely to
show the waking page.

## Never show it

If no visitor should ever wait, keep an instance running on Pro or Scale. It is
billed like any running instance:

```bash
gregale app my-app --min 1   # always keep 1 instance warm
gregale app my-app --min 0   # back to scale-to-zero (default)
```

## How other platforms compare

| Platform                 | A browser opens an app that is asleep                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gregale**              | Most wakes finish in about a tenth of a second; past 1.5 seconds, a waking page that turns into the app                                             |
| **Render (free)**        | Render shows a loading page while the service spins up, which takes about one minute                                                                |
| **Railway (serverless)** | No waiting page; Railway says the first request after sleep may return a 502 Bad Gateway                                                            |
| **Fly.io**               | Fly Proxy starts the Machine for the request; a suspended Machine resumes in a few hundred milliseconds, a cold start takes about 2 seconds or more |

In Gregale's published benchmark, 100 snapshot restores of a 256 MiB app took
95 ms at the median and 138 ms at p95, measured inside the platform. See
[Scale to zero without cold starts](/articles/scale-to-zero-without-cold-starts).

Checked against each vendor's public documentation on November 25 and 27, 2026:
[Render free instances](https://render.com/docs/free),
[Railway serverless](https://docs.railway.com/reference/app-sleeping),
[Fly.io autostop and autostart](https://docs.fly.io/launch/autostop-autostart).

## Pricing

The waking page costs nothing and comes with every plan. A parked app uses no
running time while it waits for traffic; it is billed from the moment it wakes.
Plans start at $0 (Free), then Hobby $10, Pro $30 and Scale $99 a month. See
[Gregale pricing](/pricing) and [How scaling to zero works](/docs/scale-to-zero).
