**A Slack app built with Bolt can run in HTTP mode on a host that scales to
zero, as long as the first request after an idle period is answered within
Slack's 3 seconds.** Slack expects a `2xx` for an Events API request within
three seconds and an acknowledgement of a slash command within 3,000
milliseconds. On Gregale, the Bolt app on this page wakes from a parked
snapshot in under 300 ms, acknowledges first, and keeps running whatever
work comes after the acknowledgement.

## HTTP mode or Socket Mode

Bolt receives requests from Slack one of two ways:

- **Socket Mode** connects your app to Slack over a WebSocket. The
  connection must stay open, so the app runs all the time.
- **HTTP mode** gives Slack a public Request URL, and Slack sends each event,
  command and interaction to it. Nothing has to run between requests. Bolt's
  Request URL path is `/slack/events`.

HTTP mode is what lets the app scale to zero, and the deadlines are what to
plan around:

| Request from Slack | Deadline                               | If you miss it                                                              |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------- |
| Events API event   | `2xx` within three seconds             | Retried three times: nearly immediately, after 1 minute and after 5 minutes |
| Slash command      | Acknowledged within 3,000 milliseconds | The user sees an `operation_timeout` error                                  |

A retried event carries `x-slack-retry-num` (1, 2 or 3) and
`x-slack-retry-reason`, which is `http_timeout` when your app was too slow.

## The app

The complete project, with tests that sign requests with a test signing
secret, is on GitHub as
[gregale-dev/slack-bolt-http](https://github.com/gregale-dev/slack-bolt-http).

`package.json`:

```json
{
  "name": "slack-bolt-http",
  "private": true,
  "type": "module",
  "scripts": { "start": "node app.js" },
  "dependencies": { "@slack/bolt": "^5.1.0" },
  "engines": { "node": ">=22" }
}
```

`app.js`:

```js
import { App } from '@slack/bolt';

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  customRoutes: [
    {
      path: '/healthz',
      method: ['GET'],
      handler: (req, res) => {
        res.writeHead(200);
        res.end('ok');
      },
    },
  ],
});

app.command('/ping', async ({ ack }) => {
  await ack('pong');
});

app.event('app_mention', async ({ event, say }) => {
  await say(`Hi <@${event.user}>`);
});

await app.start(Number(process.env.PORT ?? 3000));
app.logger.info('Bolt app is running');
```

Bolt checks Slack's request signature with the signing secret before any
listener runs, and answers Slack's URL verification for you. The
`customRoutes` entry adds a cheap `/healthz` path for Gregale's health check.
Without it, Bolt logs every health and warm-up request as unhandled.

## Deploy it and connect Slack

Make the app public in `gregale.yaml`, because Slack cannot send a Gregale
API key, and name the health path:

```yaml
access: public
hosting:
  health: /healthz
```

Put the bot token and signing secret from your Slack app's settings in a
secrets file, and deploy:

```bash
printf 'SLACK_BOT_TOKEN=xoxb-…\nSLACK_SIGNING_SECRET=…\n' > ../slack.secrets
gregale deploy --name my-slack-app --secrets-file ../slack.secrets
```

In the Slack app settings, set the Request URL for events, slash commands
and interactivity to `https://my-slack-app.gregale.app/slack/events`.

Bolt checks the bot token with Slack when it starts. With a wrong or revoked
`SLACK_BOT_TOKEN`, the process exits with `invalid_auth`, and
`gregale logs my-slack-app` shows it.

## Acknowledge first, then work

Call `ack()` before anything slow, such as a database query or an LLM call,
and send the result afterwards with `say()` or the command's `respond()`.
That is Bolt's default in HTTP mode, and on Gregale it works as written: the
instance keeps running while the listener works after the acknowledgement,
and the reply to a call your app made resumes a paused instance. In our
test, a 4-second outbound call started after the response finished in 4.3
seconds, without waiting for another request.

That differs from AWS Lambda, where a handler can be stopped once it has
responded. Bolt's Lambda guide uses `AwsLambdaReceiver`, and with other
receivers it requires `processBeforeResponse: true`, which defers the
acknowledgement until after your handler has run. The handler's work then
counts against Slack's 3 seconds.

Whatever the host, make event listeners safe to run twice. A retry can
deliver an event your app already handled, if the first attempt was slow
rather than lost.

## What we measured

We deployed this app on Gregale on 2026-11-27 and sent it requests signed
with a test signing secret, after letting it park. For the test only, Bolt's
token check was turned off, because the token was not a real one.

- **Memory:** 89 MB while serving, inside the Free plan's 256 MB.
- **Wake from a parked snapshot:** Gregale's wake timeline showed the
  instance running 168 ms into the wake and the first byte of the URL
  verification answer at 270 ms.
- **Slash command:** `/ping` was acknowledged with `pong`.
- **A request with a bad signature** got `401`.

About a second after each request, with nothing in flight, Gregale pauses
the instance, and paused seconds are not billed.

## How other platforms handle it

| Platform                  | Idle app                                            | First request after idle                                                |
| ------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| **Gregale**               | Paused, then parked to a snapshot; neither billed   | 270 ms to first byte in our test; work after `ack()` keeps running      |
| AWS Lambda                | Bolt uses `AwsLambdaReceiver`                       | With `processBeforeResponse: true`, acknowledged after the handler runs |
| Render (Free web service) | Spins down after 15 minutes without inbound traffic | About one minute to spin up, past Slack's 3 seconds                     |
| Heroku (Eco dyno)         | Sleeps after 30 minutes without web traffic         | Wakes "after a short delay"                                             |

Sources, checked 2026-11-27:
[Slack: Events API](https://docs.slack.dev/apis/events-api/),
[Slack: slash commands](https://docs.slack.dev/interactivity/implementing-slash-commands/),
[Slack: verifying requests](https://docs.slack.dev/authentication/verifying-requests-from-slack/),
[Bolt: custom routes](https://docs.slack.dev/tools/bolt-js/concepts/custom-routes/),
[Bolt: deploying to AWS Lambda](https://docs.slack.dev/tools/bolt-js/deployments/aws-lambda/),
[Render free instances](https://render.com/docs/free),
[Heroku Eco dyno hours](https://devcenter.heroku.com/articles/eco-dyno-hours).

## Pricing

A Bolt app in HTTP mode fits the Free plan: one app, 256 MB, and 20
included GB-RAM-hours a month, billed only while it handles requests. See
[Gregale pricing](/pricing) and
[How scaling to zero works](/docs/scale-to-zero).
